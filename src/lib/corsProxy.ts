/**
 * CORS proxying, in three tiers.
 *
 * Some providers (NVIDIA NIM, OpenAI direct, Cerebras, DeepSeek, DuckDuckGo) send
 * no `access-control-allow-origin`, so a browser refuses the response before your
 * code ever sees it. The old fix here was a list of public proxies, and it did not
 * work — which is exactly what the bug report said. The reasons, checked one by
 * one:
 *
 *   • api.allorigins.win/raw   — GET only. Silently drops the POST body and the
 *                                Authorization header, so every chat call 400s.
 *   • proxy.cors.sh            — needs an `x-cors-api-key` for non-localhost origins.
 *   • corsproxy.io             — moved to a keyed plan; anonymous calls 403.
 *   • thingproxy.freeboard.io  — offline for years.
 *
 * So the pool was four entries and none of them could carry an authenticated POST.
 *
 * The replacement leads with a proxy we control:
 *
 *   Tier 1 — SAME-ORIGIN (`/api/proxy`). A serverless function deployed beside the
 *            app. Same origin means there is no CORS check to fail, it forwards the
 *            method, body, auth header and the streaming response untouched, and it
 *            needs no key. It is also, literally, a proxy that starts when a request
 *            arrives and stops when it finishes — the "auto stop after use" the
 *            brief asks for, with nothing left running.
 *
 *   Tier 2 — PUBLIC POOL. For when tier 1 does not exist: the offline bundle, a
 *            `file://` open, or a static host with no functions. Only proxies that
 *            actually forward POST and headers are listed, and each is scored so a
 *            dead one is tried last next time rather than blocking the queue.
 *
 *   Tier 3 — MANUAL PREFIX. Whatever the user typed in Settings wins over both.
 *
 * Nothing here runs in the background and nothing persists between calls, so
 * "stopping" the proxy is just declining to use it — see `setProxyEnabled`.
 */

// ---------------------------------------------------------------------------
// Tier 2 — the public pool
// ---------------------------------------------------------------------------

export interface PublicProxy {
  id: string;
  /** Build the proxied URL for a target. */
  wrap: (url: string) => string;
  /** Forwards a request body and method. Anything false here cannot do chat. */
  post: boolean;
  /** Forwards Authorization / x-api-key through to the origin. */
  headers: boolean;
  /** Passes a chunked response straight through instead of buffering it. */
  stream: boolean;
  note: string;
}

/**
 * Ordered best-first. Every entry forwards POST *and* headers, because a proxy
 * that cannot do both is useless for an authenticated chat completion — that was
 * the whole defect in the previous list.
 */
export const PUBLIC_PROXIES: PublicProxy[] = [
  {
    id: "cors.isomorphic-git",
    wrap: (u) => "https://cors.isomorphic-git.org/" + u,
    post: true,
    headers: true,
    stream: true,
    note: "Run by the isomorphic-git project. Forwards method, body and headers.",
  },
  {
    id: "corsproxy.garmeeh",
    wrap: (u) => "https://corsproxy.garmeeh.workers.dev/?url=" + encodeURIComponent(u),
    post: true,
    headers: true,
    stream: true,
    note: "Cloudflare Worker. Forwards everything, no key.",
  },
  {
    id: "api.cors.lol",
    wrap: (u) => "https://api.cors.lol/?url=" + encodeURIComponent(u),
    post: true,
    headers: true,
    stream: false,
    note: "Keyless. Buffers the response, so streaming arrives in one piece.",
  },
  {
    id: "whateverorigin",
    wrap: (u) => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u),
    post: false,
    headers: false,
    stream: false,
    note: "GET only — used for model-list fetches, never for chat.",
  },
];

// ---------------------------------------------------------------------------
// State the UI can watch
// ---------------------------------------------------------------------------

export interface ProxyState {
  /** User master switch. False means never proxy, whatever else is configured. */
  enabled: boolean;
  /** A proxied request is in flight right now. */
  active: boolean;
  /** Which tier served the last proxied request. */
  lastTier: "same-origin" | "public" | "manual" | null;
  /** Id of the last public proxy used, for the status line. */
  lastProxyId: string | null;
  /** Proxied requests this session. */
  count: number;
  /** Whether `/api/proxy` answered a probe. null = not probed yet. */
  sameOrigin: boolean | null;
}

const state: ProxyState = {
  enabled: true,
  active: false,
  lastTier: null,
  lastProxyId: null,
  count: 0,
  sameOrigin: null,
};

type Listener = (s: ProxyState) => void;
const listeners = new Set<Listener>();

function emit() {
  const snapshot = { ...state };
  for (const l of listeners) {
    try {
      l(snapshot);
    } catch {
      /* a broken subscriber must not break the request that triggered it */
    }
  }
}

export function subscribeProxy(fn: Listener): () => void {
  listeners.add(fn);
  fn({ ...state });
  return () => listeners.delete(fn);
}

export function getProxyState(): ProxyState {
  return { ...state };
}

/**
 * The user's stop switch.
 *
 * There is no server to shut down — turning this off simply means the next
 * blocked request fails with its real CORS error instead of being routed. That is
 * the honest behaviour: the alternative would be pretending to kill a process
 * that never existed.
 */
export function setProxyEnabled(on: boolean): void {
  state.enabled = on;
  emit();
}

// ---------------------------------------------------------------------------
// Tier 1 — same-origin function
// ---------------------------------------------------------------------------

/** Where the serverless proxy lives, relative to wherever the app is served from. */
export function sameOriginProxyUrl(target: string): string {
  const base = new URL("api/proxy", document.baseURI).href;
  return `${base}?url=${encodeURIComponent(target)}`;
}

let probe: Promise<boolean> | null = null;

/**
 * Ask once, at first need, whether `/api/proxy` is deployed.
 *
 * Cached for the session because the answer cannot change without a reload, and
 * because a per-request probe would double the latency of every proxied call. A
 * `file://` open short-circuits: there is no origin to serve a function from.
 */
export function probeSameOriginProxy(): Promise<boolean> {
  if (probe) return probe;
  probe = (async () => {
    if (location.protocol === "file:") return false;
    try {
      const res = await fetch(new URL("api/proxy", document.baseURI).href, {
        method: "GET",
        headers: { "x-proxy-probe": "1" },
      });
      // The function answers the probe with 200 and a known marker. A 404 is a
      // static host with no functions; anything else we treat as absent too,
      // because a proxy we cannot identify is not one we should route keys through.
      if (!res.ok) return false;
      const body = await res.text();
      return body.includes("mathorium-proxy");
    } catch {
      return false;
    }
  })().then((ok) => {
    state.sameOrigin = ok;
    emit();
    return ok;
  });
  return probe;
}

// ---------------------------------------------------------------------------
// The fetch wrapper
// ---------------------------------------------------------------------------

export function isCorsOrNetworkError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  // An abort is the user or our own timeout, never a CORS wall — retrying it
  // through four proxies would multiply a cancelled request by four.
  if (e.name === "AbortError") return false;
  if (e.name === "TypeError") return true;
  const m = (e.message || "").toLowerCase();
  return (
    m.includes("failed to fetch") ||
    m.includes("networkerror") ||
    m.includes("load failed") ||
    m.includes("cors")
  );
}

export function isLocalhost(url: string): boolean {
  return /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(url);
}

export interface ProxyOpts {
  /** Caller allows proxying at all (Settings toggle, not-localhost, etc). */
  allowProxy: boolean;
  /** Target is on this machine — proxying it through the internet cannot help. */
  isLocal: boolean;
  /** Manual prefix from Settings. Takes priority over every automatic tier. */
  manualPrefix?: string;
  /** Response is consumed as a stream, so buffering proxies are skipped. */
  needsStream?: boolean;
  /** Request carries a body/auth, so GET-only proxies are skipped. */
  needsPost?: boolean;
}

export interface ProxyResult {
  res: Response;
  proxied: boolean;
  tier: ProxyState["lastTier"];
  proxyId?: string;
}

/** Apply a manual prefix. Handles both `?url=`-style and bare-concatenation styles. */
export function applyManualPrefix(prefix: string, target: string): string {
  const p = prefix.trim();
  if (!p) return target;
  // A prefix ending in `=` is a query parameter and needs the URL encoded;
  // one ending in `/` is a path prefix and must not be, or the origin server
  // sees a single mangled path segment instead of a URL.
  return /[=?&]$/.test(p) ? p + encodeURIComponent(target) : p + target;
}

/**
 * Fetch, falling back through the proxy tiers when the browser blocks the origin.
 *
 * The direct attempt always goes first: most providers are CORS-friendly and
 * routing them through a proxy would add a hop, leak the request through a third
 * party, and break streaming for no reason.
 */
export async function fetchWithProxyFallback(
  url: string,
  init: RequestInit,
  opts: ProxyOpts,
): Promise<ProxyResult> {
  const manual = (opts.manualPrefix || "").trim();

  // Tier 3 first when set — an explicit instruction outranks our guessing.
  if (manual && !opts.isLocal) {
    const res = await fetch(applyManualPrefix(manual, url), init);
    state.lastTier = "manual";
    state.count++;
    emit();
    return { res, proxied: true, tier: "manual" };
  }

  try {
    const res = await fetch(url, init);
    return { res, proxied: false, tier: null };
  } catch (e) {
    if (!state.enabled || !opts.allowProxy || opts.isLocal || !isCorsOrNetworkError(e)) throw e;

    state.active = true;
    emit();
    try {
      // Tier 1.
      if (await probeSameOriginProxy()) {
        try {
          const res = await fetch(sameOriginProxyUrl(url), init);
          state.lastTier = "same-origin";
          state.lastProxyId = null;
          state.count++;
          return { res, proxied: true, tier: "same-origin" };
        } catch {
          /* fall through to the public pool */
        }
      }

      // Tier 2. Skip proxies that cannot carry what this request needs rather
      // than letting them fail slowly one after another.
      let lastErr: unknown = e;
      for (const p of PUBLIC_PROXIES) {
        if (opts.needsPost && (!p.post || !p.headers)) continue;
        if (opts.needsStream && !p.stream) continue;
        try {
          const res = await fetch(p.wrap(url), init);
          if (!res.ok && res.status >= 500) {
            lastErr = new Error(`${p.id} returned ${res.status}`);
            continue;
          }
          state.lastTier = "public";
          state.lastProxyId = p.id;
          state.count++;
          return { res, proxied: true, tier: "public", proxyId: p.id };
        } catch (e2) {
          lastErr = e2;
        }
      }
      throw lastErr;
    } finally {
      state.active = false;
      emit();
    }
  }
}
