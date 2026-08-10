import { useEffect, useState } from "react";
import { getProxyState, setProxyEnabled, subscribeProxy, PUBLIC_PROXIES, probeSameOriginProxy, type ProxyState } from "@/lib/corsProxy";
import { Badge, Button, Field, TextInput } from "./ui";

/**
 * Everything about CORS proxying in one panel: what it is for, whether the
 * built-in one is available, whether it is being used, how to stop it, and how to
 * point at your own.
 *
 * The old Settings copy said "Auto CORS-proxy fallback" with a checkbox and no
 * indication of whether it had ever done anything — which is why a silently
 * broken proxy pool went unnoticed. Everything here is observable.
 */
export function CorsProxyPanel({
  proxyPrefix,
  autoCorsProxy,
  onChange,
}: {
  proxyPrefix: string;
  autoCorsProxy: boolean;
  onChange: (patch: { proxyPrefix?: string; autoCorsProxy?: boolean }) => void;
}) {
  const [state, setState] = useState<ProxyState>(getProxyState);
  const [probing, setProbing] = useState(false);

  useEffect(() => subscribeProxy(setState), []);

  // Probe once on mount so the panel can say whether the built-in proxy is
  // actually deployed rather than describing a feature that may not be there.
  useEffect(() => {
    setProbing(true);
    probeSameOriginProxy().finally(() => setProbing(false));
  }, []);

  const manual = proxyPrefix.trim();

  return (
    <section className="space-y-3 rounded-2xl border border-white/8 bg-[var(--surface-card)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-200">CORS proxy</h3>
        {probing ? (
          <Badge>checking…</Badge>
        ) : state.sameOrigin ? (
          <Badge tone="green">built-in proxy ready</Badge>
        ) : (
          <Badge tone="amber">built-in proxy unavailable</Badge>
        )}
        {state.active && <Badge tone="blue">routing…</Badge>}
        {state.count > 0 && <Badge>{state.count} proxied this session</Badge>}
      </div>

      <p className="text-[11px] leading-relaxed text-slate-400">
        A few providers — <b>NVIDIA NIM</b>, <b>OpenAI direct</b>, <b>Cerebras</b>, <b>DeepSeek</b> — refuse to send
        the header browsers require, so a direct call from this page is blocked before you ever see the response. A
        proxy relays the request from a server, where that rule does not apply. Everything else (LLM7, Puter,
        OpenRouter, Groq, Gemini, Mistral, Ollama) is called directly and never proxied.
      </p>

      <label className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-white/10 bg-[var(--surface-well)] px-3 py-2.5">
        <div>
          <div className="text-sm text-slate-200">Automatic proxy fallback</div>
          <div className="text-[11px] text-slate-500">
            Try direct first, always. Only if the browser blocks it does the request get relayed.
          </div>
        </div>
        <input
          type="checkbox"
          checked={autoCorsProxy !== false}
          onChange={(e) => onChange({ autoCorsProxy: e.target.checked })}
          className="mt-1 h-4 w-4 accent-violet-500"
        />
      </label>

      {/* Tier list — what will actually be tried, in order, given current state. */}
      <div className="space-y-1.5 rounded-xl border border-white/10 bg-[var(--surface-well)] p-3">
        <div className="text-[11px] font-medium text-slate-400">Route order</div>

        <Tier
          n={1}
          name="Built-in proxy"
          on={!manual && state.sameOrigin === true && !state.sameOriginDegraded}
          detail={
            state.sameOriginDegraded
              ? "Deployed, but a request timed out in it — the host gives it 25 seconds to start replying and a slow model can take longer. Tier 2 is carrying requests instead. Streaming replies still use this route."
              : state.sameOrigin
                ? "A serverless function deployed with this app, on this same origin. No third party sees your key, and nothing keeps running between requests — it starts per request and stops when the reply is sent."
                : "Not deployed here. Present on the hosted app; absent when the built file is opened from disk or a static host with no functions."
          }
        />
        <Tier
          n={2}
          name="Public proxies"
          on={!manual && (state.sameOrigin !== true || state.sameOriginDegraded)}
          detail={`${PUBLIC_PROXIES.filter((p) => p.post && p.headers).length} relays that forward POST bodies and auth headers. Used when the built-in one is unavailable — but as of August 2026 most free public relays have shut down, gone keyed or started refusing anonymous traffic, so treat this as a long shot rather than a safety net. Your API key would pass through a third party; prefer tier 1 or your own.`}
        />
        <Tier n={3} name="Your own prefix" on={!!manual} detail={manual || "Not set — see below."} />
      </div>

      {state.lastTier && (
        <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-[11px] text-sky-200">
          Last proxied request went via <b>{state.lastTier}</b>
          {state.lastProxyId ? ` (${state.lastProxyId})` : ""}.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={state.enabled ? "outline" : "success"}
          onClick={() => setProxyEnabled(!state.enabled)}
        >
          {state.enabled ? "■ Stop proxying now" : "▶ Resume proxying"}
        </Button>
        <span className="text-[11px] text-slate-500">
          {state.enabled
            ? "Stops all relaying for this session. Blocked providers then fail with their real error."
            : "Proxying is off — blocked providers will fail until you resume."}
        </span>
      </div>

      <details className="rounded-xl border border-white/10 bg-[var(--surface-well)] p-3">
        <summary className="cursor-pointer text-xs font-medium text-slate-300">
          Manual proxy prefix — free options and exact examples
        </summary>
        <div className="mt-3 space-y-3">
          <Field label="Proxy prefix" hint="overrides both automatic tiers">
            <TextInput
              value={proxyPrefix}
              onChange={(e) => onChange({ proxyPrefix: e.target.value })}
              placeholder="https://your-worker.workers.dev/?url="
            />
          </Field>

          <p className="text-[11px] leading-relaxed text-slate-400">
            The target URL is appended to whatever you type. If your prefix ends in{" "}
            <code className="rounded bg-black/40 px-1">=</code> or{" "}
            <code className="rounded bg-black/40 px-1">?</code> the URL is percent-encoded as a query parameter; if it
            ends in <code className="rounded bg-black/40 px-1">/</code> it is appended raw as a path. Both styles work
            — match whichever your proxy expects.
          </p>

          <div className="space-y-2 text-[11px]">
            <Example
              title="Your own Cloudflare Worker — free, unlimited, private (recommended)"
              prefix="https://YOUR-NAME.workers.dev/?url="
              body={
                <>
                  100,000 requests a day on the free plan and nobody else touches your keys. Create a Worker at{" "}
                  <a href="https://workers.cloudflare.com" target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">
                    workers.cloudflare.com
                  </a>{" "}
                  and paste:
                  <pre className="mt-1.5 overflow-x-auto rounded-lg bg-black/50 p-2 font-mono text-[10px] leading-relaxed text-slate-300">{WORKER_SNIPPET}</pre>
                </>
              }
            />
            <Example
              title="Your own Vercel deployment"
              prefix="https://YOUR-APP.vercel.app/api/proxy?url="
              body={
                <>
                  This app ships the function at <code className="rounded bg-black/40 px-1">api/proxy.ts</code>. Deploy
                  your own copy and point at it — that is tier 1 above, just addressed explicitly.
                </>
              }
            />
            <Example
              title="Public relay — no signup, but a stranger sees your key"
              prefix="https://cors.isomorphic-git.org/"
              body={<>Fine for keyless providers. Do not use it with a paid API key you care about.</>}
            />
            <Example
              title="Local, for development only"
              prefix="http://localhost:8080/"
              body={
                <>
                  <code className="rounded bg-black/40 px-1">npx cors-anywhere</code> in a terminal. Nothing leaves your
                  machine, but it only works while that terminal is open.
                </>
              }
            />
          </div>
        </div>
      </details>
    </section>
  );
}

function Tier({ n, name, on, detail }: { n: number; name: string; on: boolean; detail: string }) {
  return (
    <div className={"flex gap-2.5 rounded-lg px-2 py-1.5 " + (on ? "bg-emerald-500/8" : "opacity-55")}>
      <span
        className={
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold " +
          (on ? "bg-emerald-500/25 text-emerald-200" : "bg-white/10 text-slate-500")
        }
      >
        {n}
      </span>
      <div className="min-w-0">
        <div className={"text-[11px] font-medium " + (on ? "text-emerald-200" : "text-slate-400")}>
          {name} {on && <span className="text-[10px] font-normal">· in use</span>}
        </div>
        <div className="text-[10px] leading-relaxed text-slate-500">{detail}</div>
      </div>
    </div>
  );
}

function Example({ title, prefix, body }: { title: string; prefix: string; body: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/8 bg-black/25 p-2.5">
      <div className="text-[11px] font-medium text-slate-300">{title}</div>
      <code className="mt-1 block overflow-x-auto rounded bg-black/50 px-2 py-1 font-mono text-[10px] text-cyan-300">
        {prefix}
      </code>
      <div className="mt-1.5 text-[10px] leading-relaxed text-slate-500">{body}</div>
    </div>
  );
}

const WORKER_SNIPPET = `export default {
  async fetch(req) {
    const target = new URL(req.url).searchParams.get("url");
    if (!target) return new Response("ok");
    const h = new Headers(req.headers);
    h.delete("origin"); h.delete("referer"); h.delete("host");
    const r = await fetch(target, {
      method: req.method, headers: h,
      body: req.method === "GET" ? undefined : req.body,
    });
    const out = new Headers(r.headers);
    out.set("access-control-allow-origin", "*");
    out.set("access-control-allow-headers", "*");
    return new Response(r.body, { status: r.status, headers: out });
  },
};`;
