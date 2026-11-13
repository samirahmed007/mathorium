import { useStore } from "@/store";
import type { ThemeChoice } from "@/types";
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_CHAT_SYSTEM_PROMPT } from "@/lib/providers";
import { clearPersisted } from "@/lib/storage";
import { GgufLoader } from "./GgufLoader";
import { CorsProxyPanel } from "./CorsProxyPanel";
import { Badge, Button, Field, Select, TextArea } from "./ui";
import { APP_VERSION } from "@/lib/version";
import { DesktopSettingsSection } from "./DesktopSettingsSection";

export function SettingsTab() {
  const { settings, updateSettings, resetProviders } = useStore();

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-white">Settings · v{APP_VERSION}</h2>
        <p className="text-xs text-slate-500">Tune local mathematical recognition, editing, capture, appearance, storage and optional chat features. Desktop OCR runs only on the bundled Pix2Text or TexTeller engines.</p>
      </div>

      {window.mathoriumDesktop?.isDesktop && <DesktopSettingsSection />}

      <AppearanceSection />

      <section className="space-y-3 rounded-2xl border border-white/8 bg-[var(--surface-card)] p-4">
        <h3 className="text-sm font-semibold text-slate-200">Conversion</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Batch concurrency · ${settings.concurrency}`} hint="parallel requests">
            <input type="range" min={1} max={8} value={settings.concurrency} onChange={(e) => updateSettings({ concurrency: Number(e.target.value) })} className="w-full accent-violet-500" />
          </Field>
          <Field label={`Temperature · ${settings.temperature.toFixed(2)}`} hint="0 = deterministic">
            <input type="range" min={0} max={1} step={0.05} value={settings.temperature} onChange={(e) => updateSettings({ temperature: Number(e.target.value) })} className="w-full accent-violet-500" />
          </Field>
          <Field label="Max output tokens">
            <input type="number" min={256} max={16384} step={256} value={settings.maxTokens} onChange={(e) => updateSettings({ maxTokens: Number(e.target.value) })} className="w-full rounded-xl border border-white/10 bg-[var(--surface-well)] px-3 py-2 text-sm text-slate-100" />
          </Field>
          <Field label="Request timeout (seconds)">
            <input type="number" min={15} max={300} value={settings.requestTimeout} onChange={(e) => updateSettings({ requestTimeout: Number(e.target.value) })} className="w-full rounded-xl border border-white/10 bg-[var(--surface-well)] px-3 py-2 text-sm text-slate-100" />
          </Field>
          <Field label="Vision detail" hint="higher = more accurate, slower">
            <Select value={settings.detailLevel} onChange={(e) => updateSettings({ detailLevel: e.target.value as "high" | "low" | "auto" })}>
              <option value="high">High</option>
              <option value="low">Low (faster)</option>
              <option value="auto">Auto</option>
            </Select>
          </Field>
        </div>
        <div className="space-y-2 rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
          <h4 className="text-xs font-semibold text-violet-200">Accuracy Boosters</h4>
          <label className="flex cursor-pointer items-start justify-between gap-3 text-xs">
            <div>
              <div className="text-slate-200">Auto provider rotation <Badge tone="green">new</Badge></div>
              <div className="text-[11px] text-slate-500">When the active free provider fails (rate limit, no key, network, or no response), automatically try LLM7 → Puter → WebLLM in order. The reply is labelled with the model that actually answered.</div>
            </div>
            <input type="checkbox" checked={settings.autoFallback} onChange={(e) => updateSettings({ autoFallback: e.target.checked })} className="mt-1 h-4 w-4 accent-violet-500" />
          </label>
          <label className="flex cursor-pointer items-start justify-between gap-3 text-xs">
            <div>
              <div className="text-slate-200">Verify &amp; clean LaTeX output <Badge tone="green">new</Badge></div>
              <div className="text-[11px] text-slate-500">Post-process every conversion result: strip stray delimiters, balance braces, fix common LLM mistakes, validate via KaTeX.</div>
            </div>
            <input type="checkbox" checked={settings.verifyLatex} onChange={(e) => updateSettings({ verifyLatex: e.target.checked })} className="mt-1 h-4 w-4 accent-violet-500" />
          </label>
          <label className="flex cursor-pointer items-start justify-between gap-3 text-xs">
            <div>
              <div className="text-slate-200">Multi-pass OCR (slow, more accurate) <Badge tone="amber">experimental</Badge></div>
              <div className="text-[11px] text-slate-500">Run conversion twice and pick the result with more parseable expressions. Slower but catches single-pass mistakes.</div>
            </div>
            <input type="checkbox" checked={settings.multiPass} onChange={(e) => updateSettings({ multiPass: e.target.checked })} className="mt-1 h-4 w-4 accent-violet-500" />
          </label>
        </div>
      </section>

      {/* v6 Local OCR Engine */}
      <section className="space-y-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-cyan-200">Offline Mathematical OCR Engines</h3>
          <Badge tone="green">BUNDLED</Badge>
          <Badge tone="blue">OFFLINE</Badge>
        </div>
        <p className="text-[11px] text-slate-400">
          <b className="text-cyan-300">Pix2Text MFR</b> and <b className="text-cyan-300">TexTeller INT8</b> are the two desktop mathematical recognition engines. Both are required offline assets, loaded lazily and used locally. No Tesseract or cloud OCR fallback is part of the desktop recognition path.
        </p>
        <div className="space-y-2">
          {window.mathoriumDesktop?.isDesktop && (
            <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs">
              <div><div className="font-medium text-slate-200">Automatically recognize imported images</div><div className="mt-1 text-[11px] text-slate-500">Wait for the complete import operation, then process the queue locally. Manual Convert remains available.</div></div>
              <input type="checkbox" checked={settings.autoConvertAfterImport} onChange={(e) => updateSettings({ autoConvertAfterImport: e.target.checked })} className="mt-1 h-4 w-4 accent-violet-500" />
            </label>
          )}
          <Field label="Recognition quality" hint="mapped to each model's supported decoding settings">
            <Select value={settings.recognitionQuality} onChange={(e) => updateSettings({ recognitionQuality: e.target.value as any })}>
              <option value="fast">Fast</option><option value="balanced">Balanced</option><option value="high-accuracy">High Accuracy</option>
            </Select>
          </Field>
          {window.mathoriumDesktop?.isDesktop ? (
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-2.5 text-[11px] text-emerald-200">
              Desktop OCR is locked to the two installed offline mathematical engines. Select Pix2Text MFR or TexTeller 3.0 INT8 below. No screenshot or image is sent to a cloud provider.
            </div>
          ) : (
            <Field label="Conversion engine" hint="which engine the Convert tab uses">
              <Select value={settings.convertEngine} onChange={(e) => updateSettings({ convertEngine: e.target.value as any })}>
                <option value="both">Both — Pix2Text first, cloud vision as fallback ⭐</option>
                <option value="local">Local only — Pix2Text, 100% offline</option>
                <option value="cloud">Cloud only — vision model, no local OCR</option>
              </Select>
            </Field>
          )}
          {!window.mathoriumDesktop?.isDesktop && settings.convertEngine === "both" && (
            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-2.5 text-[11px] text-cyan-200/80">
              Recommended. Every image is read on-device first. Only if Pix2Text fails does the selected cloud vision model get the image — and if that fails too, the result card shows <b>both</b> causes, never one masking the other.
            </div>
          )}
          {!window.mathoriumDesktop?.isDesktop && settings.convertEngine === "local" && (
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-2.5 text-[11px] text-emerald-200">
              Fully offline — no network request is made and no image leaves your machine. If Pix2Text cannot read an image, that image is marked failed with the real reason; there is no cloud fallback. Works with no API key and no internet connection.
            </div>
          )}
          {!window.mathoriumDesktop?.isDesktop && settings.convertEngine === "cloud" && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
              Pix2Text is skipped entirely; images are sent to the cloud provider selected in the Convert tab, which must be a <b>Vision</b> model. Accuracy on cropped formulas is usually lower than the local engine, and it needs a working network connection.
            </div>
          )}
          {(window.mathoriumDesktop?.isDesktop || settings.convertEngine !== "cloud") && (
            <>
              <Field label="Local engine" hint="Both models are offline math recognition engines; only one is loaded at a time">
                <Select value={settings.localOCRModel} onChange={(e) => updateSettings({ localOCRModel: e.target.value as any })}>
                  <option value="auto">Pix2Text MFR — recommended for math ⭐</option>
                  <option value="pix2text">Pix2Text MFR (same model, pinned)</option>
                  <option value="texteller">TexTeller 3.0 INT8 — complex and long formulas</option>
                  {!window.mathoriumDesktop?.isDesktop && <option value="tesseract">Tesseract.js — plain text only (web edition)</option>}
                </Select>
              </Field>
              {!window.mathoriumDesktop?.isDesktop && settings.localOCRModel === "tesseract" && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
                  Tesseract is available only in the web edition for explicitly selected plain-text OCR. It is not included or used by Mathorium Desktop mathematical recognition.
                </div>
              )}
              {settings.localOCRModel === "texteller" && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
                  TexTeller 3 uses the bundled INT8 encoder and merged decoder. It is loaded on demand, uses CPU/WASM by default, and never downloads model files at runtime.
                </div>
              )}
              <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-2.5 text-[11px] text-cyan-200/80">
                <b>Pix2Text MFR</b> from <a href="https://huggingface.co/breezedeus/pix2text-mfr" target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">breezedeus/pix2text</a>, trained on printed and handwritten formulas. Works best on a <b>single cropped formula</b> — crop tightly for the best result. A formula takes a few seconds on CPU; the first run also spends a moment initializing the model.
              </div>
            </>
          )}
          <label className="flex cursor-pointer items-start justify-between gap-3 text-xs">
            <div>
              <div className="text-slate-200">Enhanced LaTeX → MathML (multi-engine)</div>
              <div className="text-[11px] text-slate-500">Use temml + latex2mathml + KaTeX fallback chain for maximum MathML accuracy. Handles complex math without losing characters.</div>
            </div>
            <input type="checkbox" checked={settings.enhancedMathml} onChange={(e) => updateSettings({ enhancedMathml: e.target.checked })} className="mt-1 h-4 w-4 accent-cyan-500" />
          </label>
        </div>
      </section>

      <GgufLoader />

      <section className="space-y-3 rounded-2xl border border-white/8 bg-[var(--surface-card)] p-4">
        <h3 className="text-sm font-semibold text-slate-200">Chat</h3>

        {/* Agent Mode first: it changes what every reply is, so it outranks the
            formatting toggles below it. */}
        <div className="space-y-2 rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
          <label className="flex cursor-pointer items-start justify-between gap-3 text-xs">
            <div>
              <div className="text-slate-200">✦ Agent Mode <Badge tone="green">v8</Badge> <Badge tone="blue">on by default</Badge></div>
              <div className="text-[11px] leading-relaxed text-slate-500">
                Answer in passes instead of one shot: plan the approach, work the problem, audit the draft as a
                hostile reviewer, then rewrite whatever the audit faults. Most of the gap between a small free model
                and a large paid one is process rather than knowledge, and this is the process — an ordinary model
                with Agent Mode on answers well above its own weight. Costs two or three extra round trips per reply.
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.agentMode !== false}
              onChange={(e) => updateSettings({ agentMode: e.target.checked })}
              className="mt-1 h-4 w-4 accent-violet-500"
            />
          </label>
          {settings.agentMode !== false && (
            <Field label="Agent depth" hint="how much extra work per reply">
              <Select
                value={settings.agentDepth ?? "balanced"}
                onChange={(e) => updateSettings({ agentDepth: e.target.value as "quick" | "balanced" | "thorough" })}
              >
                <option value="quick">Quick — audit only (1 extra pass)</option>
                <option value="balanced">Balanced — plan, audit, revise (2–3 passes)</option>
                <option value="thorough">Thorough — audit and revise twice (up to 5 passes)</option>
              </Select>
            </Field>
          )}
        </div>

        <div className="space-y-2">
          <label className="flex cursor-pointer items-start justify-between gap-3 text-xs">
            <div>
              <div className="text-slate-200">Stream chat responses</div>
              <div className="text-[11px] text-slate-500">Show replies word-by-word as they arrive. Disable if your provider has streaming issues.</div>
            </div>
            <input type="checkbox" checked={settings.streamChat} onChange={(e) => updateSettings({ streamChat: e.target.checked })} className="mt-1 h-4 w-4 accent-violet-500" />
          </label>
          <label className="flex cursor-pointer items-start justify-between gap-3 text-xs">
            <div>
              <div className="text-slate-200">Send on Enter (Shift+Enter for newline)</div>
              <div className="text-[11px] text-slate-500">Disable to use Enter for newline only (then click Send button).</div>
            </div>
            <input type="checkbox" checked={settings.sendOnEnter} onChange={(e) => updateSettings({ sendOnEnter: e.target.checked })} className="mt-1 h-4 w-4 accent-violet-500" />
          </label>
          <label className="flex cursor-pointer items-start justify-between gap-3 text-xs">
            <div>
              <div className="text-slate-200">Continue long answers automatically</div>
              <div className="text-[11px] text-slate-500">When a reply stops at the max-tokens cap, ask for the rest and stitch it on. Uses extra requests on long derivations.</div>
            </div>
            <input type="checkbox" checked={settings.autoContinue} onChange={(e) => updateSettings({ autoContinue: e.target.checked })} className="mt-1 h-4 w-4 accent-violet-500" />
          </label>
          <label className="flex cursor-pointer items-start justify-between gap-3 text-xs">
            <div>
              <div className="text-slate-200">Show token counter</div>
              <div className="text-[11px] text-slate-500">Display estimated token usage in the chat composer. Helps avoid context overflow.</div>
            </div>
            <input type="checkbox" checked={settings.showTokenCount} onChange={(e) => updateSettings({ showTokenCount: e.target.checked })} className="mt-1 h-4 w-4 accent-violet-500" />
          </label>
          <Field label={`Max chat history · ${settings.maxChatHistory} conversations`} hint="persisted locally">
            <input type="range" min={5} max={100} step={5} value={settings.maxChatHistory} onChange={(e) => updateSettings({ maxChatHistory: Number(e.target.value) })} className="w-full accent-violet-500" />
          </Field>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Chat system prompt</span>
            <Button size="sm" variant="ghost" onClick={() => updateSettings({ chatSystemPrompt: DEFAULT_CHAT_SYSTEM_PROMPT })}>↺ Reset</Button>
          </div>
          <TextArea value={settings.chatSystemPrompt} onChange={(e) => updateSettings({ chatSystemPrompt: e.target.value })} rows={6} />
        </div>
      </section>

      <CorsProxyPanel
        proxyPrefix={settings.proxyPrefix}
        autoCorsProxy={settings.autoCorsProxy}
        onChange={updateSettings}
      />

      <section className="space-y-3 rounded-2xl border border-white/8 bg-[var(--surface-card)] p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200">Extraction system prompt (OCR)</h3>
          <Button size="sm" variant="ghost" onClick={() => updateSettings({ systemPrompt: DEFAULT_SYSTEM_PROMPT })}>↺ Reset</Button>
        </div>
        <TextArea value={settings.systemPrompt} onChange={(e) => updateSettings({ systemPrompt: e.target.value })} rows={10} />
        <p className="text-[11px] text-slate-500">This prompt is sent to the vision model for every image. Customise how it formats LaTeX. The default is heavily tuned for accuracy with explicit examples and edge cases.</p>
      </section>

      <section className="space-y-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-rose-200">Danger zone <Badge tone="rose">careful</Badge></h3>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => { if (confirm("Reset all providers, models and settings to defaults?")) resetProviders(); }}>Reset providers & settings</Button>
          <Button variant="danger" size="sm" onClick={() => { if (confirm("Erase ALL local data (providers, keys, settings, chat history) and reload?")) { clearPersisted(); location.reload(); } }}>Erase all local data</Button>
        </div>
      </section>
    </div>
  );
}

/**
 * Theme picker. Three explicit cards rather than a cycling icon: the header
 * button cycles because it has room for one glyph, but a settings page should
 * show what the options are and which one is live.
 */
function AppearanceSection() {
  const { theme, setTheme, resolvedTheme } = useStore();

  const CHOICES: { id: ThemeChoice; icon: string; label: string; hint: string }[] = [
    { id: "dark", icon: "☾", label: "Dark", hint: "The default. Tuned for long sessions and low light." },
    { id: "light", icon: "☀", label: "Light", hint: "Crisp white cards on a soft page. Good in daylight and for printing." },
    { id: "system", icon: "🖥", label: "System", hint: "Follow your OS and switch with it, including on a schedule." },
  ];

  return (
    <section className="space-y-3 rounded-2xl border border-white/8 bg-[var(--surface-card)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-200">Appearance</h3>
        {theme === "system" && <Badge tone="blue">following OS · {resolvedTheme}</Badge>}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {CHOICES.map((c) => {
          const on = theme === c.id;
          return (
            <button
              key={c.id}
              onClick={() => setTheme(c.id)}
              aria-pressed={on}
              className={
                "rounded-xl border p-3 text-left transition-colors " +
                (on
                  ? "border-violet-400/50 bg-violet-500/10"
                  : "border-white/10 bg-[var(--surface-well)] hover:border-white/20 hover:bg-white/5")
              }
            >
              <div className="flex items-center gap-2">
                <span className="text-base">{c.icon}</span>
                <span className={"text-sm font-medium " + (on ? "text-violet-200" : "text-slate-300")}>{c.label}</span>
                {on && <span className="ml-auto text-[10px] font-semibold text-violet-300">ACTIVE</span>}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{c.hint}</p>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-500">
        Cycle from anywhere with <kbd className="rounded bg-black/40 px-1">⌘⇧L</kbd>, or search “theme” in the command
        palette to jump straight to one.
      </p>
    </section>
  );
}
