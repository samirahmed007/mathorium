import { Badge, Button, Card } from "./ui";
import { MathoriumMark } from "./Brand";
import { useStore } from "@/store";
import { APP_AUTHOR, APP_BUILD, APP_NAME, APP_TAGLINE, APP_VERSION } from "@/lib/version";

export function AboutTab() {
  const { providers, activeProvider } = useStore();
  const freeProviders = providers.filter((p) => p.free);
  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <div className="flex items-center gap-3">
          <MathoriumMark size={44} className="shrink-0 drop-shadow-lg" title={APP_NAME} />
          <div>
            <h2 className="text-xl font-semibold text-white">{APP_NAME} <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-300">v{APP_VERSION}</span></h2>
            <p className="text-xs text-slate-500">{APP_TAGLINE} · build {APP_BUILD}</p>
          </div>
          <Badge tone="green" className="ml-auto">100% client-side</Badge>
        </div>
      </div>

      <Card className="p-5">
        <h3 className="mb-2 text-sm font-semibold text-white">About {APP_NAME} {APP_VERSION}</h3>
        <p className="text-sm leading-relaxed text-slate-300">
          <b>{APP_NAME} {APP_VERSION}</b> is a completely free, professional-grade, intelligent math conversation and OCR web application —
          the open <b>Mathpix alternative</b>, fully functional, with <b>zero mock data</b>. Convert any kind of mathematics —
          handwriting, printed textbooks, PDF screenshots, whiteboards, complex matrices, integrals, tensors — into flawless
          <b> single-line LaTeX</b> and <b>presentation MathML</b>, batch process hundreds of images, chat about math with live rendering,
          and export to HTML (double-column), LaTeX, MathML, Markdown, JSON, CSV, and a self-contained <b>ZIP bundle</b>.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          v8 adds <b>Agent Mode</b>, on by default: every chat reply is planned, then audited by the model as a hostile
          reviewer, then rewritten wherever the audit finds a defect — which is most of what separates a small free model
          from a large paid one. Also new: the <b>MathType-style visual equation editor</b> — since v8.2 a tab of its own,
          opened from any converted expression with the source image beside it — and support for <b>local GGUF models</b>
          loaded straight off your disk.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          It runs <b>fully offline</b> out of the box: the bundled <b>Pix2Text MFR</b> model does math OCR in your browser with no key
          and no network, and <b>WebLLM</b> or your own <b>.gguf file</b> gives you an in-browser chat model. For cloud work there is a
          <b> smart auto-rotation chain</b> (LLM7 → Puter → WebLLM → Pollinations) so a usage limit on one provider silently moves to
          the next. Add any OpenAI-compatible provider, edit models, or point at a local <b>Ollama</b>.
          All API keys stay in your browser — nothing is sent to Mathorium servers (there are none).
        </p>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-4">
          <h4 className="mb-2 text-sm font-semibold text-slate-200">v{APP_VERSION} Highlights</h4>
          <ul className="space-y-1 text-xs text-slate-400">
            <li>• <b className="text-cyan-300">NEW</b> Renamed to <b>{APP_NAME}</b>, with a new mark and full icon set</li>
            <li>• <b className="text-cyan-300">NEW</b> Live model lists: every provider fetches its own catalogue, and vision/free are set from what each model reports</li>
            <li>• <b className="text-cyan-300">NEW</b> Screen snip in Convert — delayed and repeat capture, crop, straight into the queue</li>
            <li>• <b className="text-cyan-300">NEW</b> Image generation lists the free providers' image models, plus Perchance</li>
            <li>• <b className="text-cyan-300">NEW</b> Local GGUF models can be added from the Providers tab, not only Settings</li>
            <li>• <b className="text-cyan-300">NEW</b> Chat rendering rebuilt: tables, callouts, footnotes, task lists, copy-per-block</li>
            <li>• <b className="text-cyan-300">FIX</b> Light and System themes rebuilt from the token layer up — 0 low-contrast nodes across every tab</li>
            <li>• <b className="text-cyan-300">FIX</b> Voice input actually works, and says why when the browser refuses</li>
            <li>• <b className="text-cyan-300">FIX</b> The CORS proxy falls back silently, and you can stop it</li>
            <li>• <b className="text-violet-300">v8.3</b> Thinking panel — a reasoning model's chain of thought, kept out of the answer</li>
            <li>• <b className="text-violet-300">v8.3</b> Syntax highlighting in chat code blocks, per fence language</li>
            <li>• <b className="text-violet-300">v8.2</b> MathType is a full standalone editor tab, not a pop-up dialog</li>
            <li>• <b className="text-violet-300">v8</b> Agent Mode: plan → solve → audit → correct, on by default</li>
            <li>• <b className="text-violet-300">v8</b> Local GGUF models from disk via llama.cpp in WebAssembly</li>
            <li>• Offline math OCR: bundled Pix2Text MFR, no key, no network</li>
            <li>• Chat auto-continues past the token cap — no cut-off answers</li>
            <li>• Matrix alignment preserved in MathML export (columnalign + xmlns)</li>
            <li>• Smart auto-rotation, naming the model that actually replied</li>
            <li>• Command palette (⌘K), light/dark theme, installable PWA</li>
            <li>• Batch convert: 500+ images, auto-retry ×3, retry-failed-only</li>
            <li>• Bulletproof math rendering via <b>KaTeX</b> + MathML via temml</li>
            <li>• 9 export formats: HTML, ZIP, TeX, MathML, MD, JSON, CSV, TXT</li>
          </ul>
        </Card>
        <Card className="p-4">
          <h4 className="mb-2 text-sm font-semibold text-slate-200">Free no-key providers</h4>
          <div className="flex flex-wrap gap-1.5">
            {freeProviders.slice(0, 8).map((p) => (
              <Badge key={p.id} tone={p.id === activeProvider.id ? "blue" : "green"}>{p.name.split("·")[0].trim()}</Badge>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            Current active: <b className="text-slate-300">{activeProvider.name}</b><br/>
            Default: <b className="text-orange-300">LLM7</b> — answers with no key on its turbo models (verified live 2026-08-04).<br/>
            Truly keyless and offline: <b className="text-violet-300">WebLLM</b> (WebGPU), <b className="text-violet-300">Local GGUF</b> (your own file, no GPU needed), and the bundled <b className="text-violet-300">Pix2Text</b> OCR engine.<br/>
            <b className="text-slate-400">Puter</b> is the only free vision option but needs an interactive sign-in; <b className="text-slate-400">Pollinations</b> text is Turnstile-gated though image gen is still free; <b className="text-slate-400">DuckDuckGo</b> is CORS-blocked in browsers.<br/>
            Free tiers with a key: <b className="text-slate-400">HuggingFace</b>, <b className="text-slate-400">Google Gemini</b>, <b className="text-slate-400">OpenRouter</b>, <b className="text-slate-400">Groq</b>, <b className="text-slate-400">NVIDIA NIM</b>, <b className="text-slate-400">Ollama</b>.
          </p>
        </Card>
      </div>

      <Card className="border-violet-500/20 bg-gradient-to-br from-violet-500/5 to-indigo-500/5 p-5">
        <h4 className="text-sm font-semibold text-white">Developer</h4>
        <p className="mt-1 text-[13px] text-slate-300">
          <b className="text-violet-300 text-[15px]">{APP_AUTHOR}</b><br/>
          Full-stack AI engineer · {APP_NAME} creator<br/>
          Building professional-grade, free, open AI tools for mathematics, OCR, and scientific communication.
        </p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="outline" onClick={() => window.open("https://github.com", "_blank")}>GitHub</Button>
          <Button size="sm" variant="ghost" onClick={() => alert(`${APP_NAME} ${APP_VERSION} (build ${APP_BUILD}) — ${APP_TAGLINE}\nDeveloped by ${APP_AUTHOR}\n\nv9.0 is the rename release: a new mark and icon set, a rewritten landing shell so search engines see the app instead of an empty page, and a version constant so the UI can no longer disagree with itself about which release it is.\n\nWhat is new in the app itself: every provider fetches its own live model catalogue and marks each model vision-capable or free from what the provider actually reports, rather than a hand-maintained list that went stale. Convert has a screen snip — delayed capture, repeat capture, crop, straight into the queue. Image generation lists the free providers' image models and adds Perchance. Local GGUF models can be added from the Providers tab. Chat rendering was rebuilt for tables, callouts, footnotes, task lists and per-block copy.\n\nFixed in v9.0: the Light and System themes, rebuilt from the token layer up and verified at zero low-contrast nodes on every tab; voice input, which now works and explains itself when a browser refuses; and the CORS proxy, which falls back silently and can be stopped.\n\nCarried from v8: Agent Mode (plan, solve, self-audit, correct), the MathType editor as a standalone tab, offline Pix2Text OCR with no key and no network, and chat replies that continue past the token cap.`)}>About v{APP_VERSION}</Button>
        </div>
      </Card>

      <p className="text-center text-[11px] text-slate-600">
        {APP_NAME} {APP_VERSION} © 2026 · Free · Open · Private · Installable PWA · Built for mathematicians, students, researchers &amp; educators.<br/>
        Math rendering via <b>KaTeX</b> · Visual editing via <b>MathLive</b> · MathML export via <b>temml</b> · ZIP via <b>JSZip</b> · In-browser LLM via <b>WebLLM</b> and <b>wllama</b> · 100% browser-side.
      </p>
    </div>
  );
}
