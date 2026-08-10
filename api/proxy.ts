/**
 * Same-origin CORS proxy — Vercel Edge Function.
 *
 * Deployed alongside the static bundle at `/api/proxy`. Because it answers on the
 * app's own origin there is no cross-origin check to fail, so a provider that
 * refuses to send `access-control-allow-origin` (NVIDIA NIM, OpenAI direct,
 * Cerebras, DeepSeek) becomes reachable from the browser with no third-party
 * proxy, no API key and nothing for the user to install or run.
 *
 * Lifecycle is the point: an edge function is spun up for a request and torn down
 * after it. There is no daemon to start, no port to bind, nothing left listening
 * once the reply is sent. "Auto-stops after use" is the platform's default rather
 * than something the app has to manage.
 *
 * Runs on the edge runtime specifically so that `fetch`'s streaming body can be
 * returned untouched — a Node serverless function would buffer it, and buffering
 * turns token-by-token chat into one lump arriving at the end.
 */

export const config = { runtime: "edge" };

/** Requests the browser sends that must not be forwarded to the origin. */
const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  // Vercel's own routing metadata. Forwarding it confuses some origins.
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-for",
  "x-vercel-id",
  "x-vercel-deployment-url",
  "x-real-ip",
]);

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-max-age": "86400",
  // Without this the client cannot read PASSTHROUGH_HEADER on a cross-origin
  // call — non-safelisted response headers are hidden from JS unless exposed.
  // Same-origin calls (the normal case) would see it anyway; this covers the
  // app being pointed at someone else's deployment via a manual prefix.
  "access-control-expose-headers": "*",
};

/**
 * Set only on a response this function actually relayed from the origin.
 *
 * It exists so the client can tell two very different 5xx apart. A 502 or 504
 * arriving from `/api/proxy` may be the origin's own answer, faithfully passed
 * on — or it may be the platform underneath this function, which the code here
 * never gets to see or annotate. The edge runtime has to emit its first byte
 * within 25 seconds, and a non-streaming completion from a large model can take
 * longer than that, at which point Vercel returns a 504 of its own and this
 * handler is simply killed. Presence of this header means "the origin said
 * this"; absence on a 5xx means "we failed before the origin answered", and the
 * client should try another route rather than report it as the provider's fault.
 */
const PASSTHROUGH_HEADER = "x-mathorium-proxy";

/**
 * Only proxy to public HTTP(S) endpoints.
 *
 * An open proxy that will fetch anything is a liability: pointed at `file://`,
 * at a cloud metadata endpoint (169.254.169.254) or at a private range it becomes
 * a way to read things from inside the deployment's network. This is a blunt
 * check rather than a complete SSRF defence — it blocks the obvious targets and
 * the literal loopback/link-local addresses, which is proportionate for a proxy
 * whose only job is reaching well-known public LLM APIs.
 */
function isAllowedTarget(raw: string): { ok: true; url: URL } | { ok: false; why: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, why: "url parameter is not a valid absolute URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, why: "only http and https targets are allowed" };
  }
  const host = url.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    host === "::1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (blocked) return { ok: false, why: "private, loopback and link-local targets are not proxied" };
  return { ok: true, url };
}

export default async function handler(req: Request): Promise<Response> {
  // Preflight. Answered here so the browser never has to ask the origin.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const self = new URL(req.url);
  const target = self.searchParams.get("url");

  // The probe the client uses to find out whether this function is deployed at
  // all. Answering with a known marker means a static host's SPA fallback —
  // which would return index.html with a cheerful 200 — is not mistaken for a
  // working proxy.
  if (!target) {
    return new Response("mathorium-proxy ok", {
      status: 200,
      headers: { ...CORS_HEADERS, "content-type": "text/plain; charset=utf-8" },
    });
  }

  const check = isAllowedTarget(target);
  if (!check.ok) {
    return new Response(JSON.stringify({ error: check.why }), {
      status: 400,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  // Some providers reject a browser Origin/Referer outright. Stripping them makes
  // the call look like the server-to-server request it now actually is.
  headers.delete("origin");
  headers.delete("referer");
  headers.delete("cookie");

  try {
    const upstream = await fetch(check.url.toString(), {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      redirect: "follow",
      // Required by the fetch spec when streaming a request body through.
      ...({ duplex: "half" } as RequestInit),
    });

    const out = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(CORS_HEADERS)) out.set(k, v);
    // The origin answered, whatever it answered with. See PASSTHROUGH_HEADER.
    out.set(PASSTHROUGH_HEADER, "origin");
    // The origin's own CORS answer is irrelevant now and would collide with ours.
    out.delete("access-control-allow-credentials");
    // Content-encoding was already undone by fetch; leaving the header on makes
    // the browser try to decode plain bytes a second time.
    out.delete("content-encoding");
    out.delete("content-length");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: out,
    });
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: "proxy request failed",
        detail: e instanceof Error ? e.message : String(e),
        target: check.url.origin,
      }),
      { status: 502, headers: { ...CORS_HEADERS, "content-type": "application/json" } },
    );
  }
}
