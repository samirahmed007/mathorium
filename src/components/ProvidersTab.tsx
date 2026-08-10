import { useState } from "react";
import type { AuthScheme, ModelDef, Provider } from "@/types";
import { useStore } from "@/store";
import { blankProvider } from "@/lib/providers";
import { testConnection, fetchModelList, defaultModelsPath } from "@/lib/llm";
import { Badge, Button, Field, Modal, Select, Spinner, TextInput, TextArea } from "./ui";
import { OllamaSetupHelper } from "./OllamaSetupHelper";
import { GgufLoader } from "./GgufLoader";

const AUTH_OPTIONS: { id: AuthScheme; label: string }[] = [
  { id: "bearer", label: "Bearer token (Authorization: Bearer …)" },
  { id: "x-api-key", label: "x-api-key header" },
  { id: "none", label: "No authentication" },
];

export function ProvidersTab() {
  const { providers, removeProvider, duplicateProvider, resetProviders, setActiveProvider } = useStore();
  const [editing, setEditing] = useState<Provider | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [ollamaHelp, setOllamaHelp] = useState(false);

  const openNew = () => {
    setEditing(blankProvider());
    setIsNew(true);
  };
  const openEdit = (p: Provider) => {
    setEditing(JSON.parse(JSON.stringify(p)));
    setIsNew(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Providers & Models</h2>
          <p className="text-xs text-slate-500">Add, edit, duplicate or remove any OpenAI-compatible endpoint. Configure models & keys.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => { if (confirm("Reset all providers & models to presets? Your custom providers will be removed.")) resetProviders(); }}>↺ Reset presets</Button>
          <Button variant="primary" size="sm" onClick={openNew}>＋ Add provider</Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {providers.map((p) => (
          <div key={p.id} className="rounded-2xl border border-white/8 bg-[var(--surface-card)] p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 h-9 w-1.5 rounded-full" style={{ background: p.color || "#64748b" }} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate font-semibold text-slate-100">{p.name}</h3>
                  {p.free && <Badge tone="green">Free · no key</Badge>}
                  {p.builtin ? <Badge>builtin</Badge> : <Badge tone="blue">custom</Badge>}
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{p.description}</p>
                <div className="mt-1.5 truncate font-mono text-[11px] text-slate-600">{p.baseUrl}<span className="text-slate-500">{p.chatPath}</span></div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.models.slice(0, 6).map((m) => (
                    <span key={m.id} className={"rounded-md border px-1.5 py-0.5 text-[10px] " + (m.vision ? "border-sky-500/30 bg-sky-500/10 text-sky-300" : "border-white/10 bg-white/5 text-slate-400")}>
                      {m.vision ? "👁 " : ""}{m.label || m.id}
                    </span>
                  ))}
                  {p.models.length > 6 && <span className="text-[10px] text-slate-500">+{p.models.length - 6} more</span>}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/8 pt-3">
              <Button size="sm" variant="subtle" onClick={() => { setActiveProvider(p.id); }}>Use</Button>
              <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => duplicateProvider(p.id)}>Duplicate</Button>
              {p.id === "ollama" && <Button size="sm" variant="subtle" onClick={() => setOllamaHelp(true)}>🦙 Setup</Button>}
              <Button size="sm" variant="ghost" className="ml-auto text-rose-300" disabled={providers.length <= 1} onClick={() => removeProvider(p.id)}>Remove</Button>
            </div>
            {p.notes && <p className="mt-2 text-[11px] text-amber-300/70">ⓘ {p.notes}</p>}
            {p.id === "ollama" && (
              <button onClick={() => setOllamaHelp(true)} className="mt-2 w-full rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-left text-[11px] text-emerald-300 hover:bg-emerald-500/10">
                ⚡ Getting a CORS / connection error? Open the <b>Ollama Setup Helper</b> → one-click auto-fix script + live test.
              </button>
            )}
          </div>
        ))}
      </div>

      {/* The same offline-model loader the Settings tab offers. It lives here too
          because "add a model to a provider" is the job this tab is for, and the
          Local GGUF provider is the one whose models come off your disk rather
          than from an endpoint — so looking for it here is the obvious instinct. */}
      <GgufLoader />

      {editing && <ProviderEditor provider={editing} isNew={isNew} onClose={() => setEditing(null)} />}
      <OllamaSetupHelper open={ollamaHelp} onClose={() => setOllamaHelp(false)} />
    </div>
  );
}

function ProviderEditor({ provider, isNew, onClose }: { provider: Provider; isNew: boolean; onClose: () => void }) {
  const { addProvider, updateProvider, settings } = useStore();
  const [draft, setDraft] = useState<Provider>(provider);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchInfo, setFetchInfo] = useState("");

  const set = (patch: Partial<Provider>) => setDraft((d) => ({ ...d, ...patch }));

  const setModel = (i: number, patch: Partial<ModelDef>) =>
    setDraft((d) => ({ ...d, models: d.models.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));
  const addModel = () => set({ models: [...draft.models, { id: "", label: "", vision: false }] });
  const removeModel = (i: number) => set({ models: draft.models.filter((_, j) => j !== i) });

  const save = () => {
    const cleaned: Provider = {
      ...draft,
      models: draft.models.filter((m) => m.id.trim()).map((m) => ({ ...m, label: m.label?.trim() || m.id })),
      visionDefault: draft.visionDefault || draft.models.find((m) => m.vision)?.id || draft.models[0]?.id || "",
      textDefault: draft.textDefault || draft.models[0]?.id || "",
    };
    if (isNew) addProvider(cleaned);
    else updateProvider(cleaned.id, cleaned);
    onClose();
  };

  const test = async () => {
    setTesting(true);
    setTestResult("");
    try {
      // The probe below sends text and no image, so the text default is what it
      // should exercise. Testing `visionDefault` picked the heaviest model the
      // provider has for a message that cannot use it — on NVIDIA that meant a
      // 90B vision model answering "Reply with exactly: OK", slowly enough to
      // trip the proxy's 25 s gateway limit and report a working key as broken.
      const model =
        draft.textDefault ||
        draft.models.find((m) => !m.vision)?.id ||
        draft.visionDefault ||
        draft.models[0]?.id ||
        "";
      const out = await testConnection({
        provider: draft,
        model,
        settings,
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
      });
      setTestResult("✓ Connected — model replied: \"" + out.trim().slice(0, 60) + "\"");
    } catch (e: unknown) {
      setTestResult("✗ " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setTesting(false);
    }
  };

  const fetchModels = async () => {
    setFetching(true);
    setFetchInfo("");
    try {
      // `fetchModelList` already merges the live list over the curated one and
      // classifies vision/free/context from whatever metadata came back, so the
      // component just stores the result.
      const merged = await fetchModelList(draft, settings);
      const added = merged.length - draft.models.length;
      set({
        models: merged,
        // The user has now taken ownership of this list, so a later app upgrade
        // must not silently overwrite it with the code catalogue.
        modelsEdited: true,
      });
      setFetchInfo(
        `✓ ${merged.length} models · ${merged.filter((m) => m.vision).length} vision · ` +
          `${merged.filter((m) => m.free).length} free` +
          (added > 0 ? ` · ${added} new` : ""),
      );
    } catch (e: unknown) {
      setFetchInfo("✗ " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setFetching(false);
    }
  };

  // Where "Fetch live" will actually go: the field if the user filled it in, the
  // conventional OpenAI-compatible path otherwise. Showing the derived value is
  // what makes the button safe to press on a provider with an empty field.
  const effectiveModelsPath = (draft.modelsPath || "").trim() || defaultModelsPath(draft);

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={isNew ? "Add provider" : "Edit · " + draft.name}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save provider</Button></>}
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Display name"><TextInput value={draft.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Accent color"><input type="color" value={draft.color || "#64748b"} onChange={(e) => set({ color: e.target.value })} className="h-9 w-full rounded-lg border border-white/10 bg-[var(--surface-well)]" /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Base URL" hint="no trailing slash"><TextInput value={draft.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://api.example.com/v1" /></Field>
          <Field label="Chat path" hint="appended to base"><TextInput value={draft.chatPath} onChange={(e) => set({ chatPath: e.target.value })} placeholder="/chat/completions" /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Auth scheme"><Select value={draft.authScheme} onChange={(e) => set({ authScheme: e.target.value as AuthScheme })}>{AUTH_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></Field>
          <Field label="API key" hint="stored locally only"><TextInput type="password" value={draft.apiKey} placeholder={draft.apiKeyPlaceholder || "sk-…"} onChange={(e) => set({ apiKey: e.target.value })} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Signup URL"><TextInput value={draft.signupUrl || ""} onChange={(e) => set({ signupUrl: e.target.value })} placeholder="https://…" /></Field>
          <Field label="Docs URL"><TextInput value={draft.docsUrl || ""} onChange={(e) => set({ docsUrl: e.target.value })} placeholder="https://…" /></Field>
        </div>

        {/* models */}
        <div className="rounded-xl border border-white/10 bg-[var(--surface-well)] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-400">Models</span>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={fetchModels}
                disabled={fetching || !effectiveModelsPath}
                title={
                  effectiveModelsPath
                    ? `GET ${effectiveModelsPath}`
                    : "This provider has no HTTP model list — its models are fixed in the app."
                }
              >
                {fetching ? <Spinner /> : "↻ Fetch live"}
              </Button>
              <Button size="sm" variant="subtle" onClick={addModel}>＋ Add model</Button>
            </div>
          </div>
          {fetchInfo && <div className={"mb-2 text-[11px] " + (fetchInfo.startsWith("✓") ? "text-emerald-300" : "text-rose-300")}>{fetchInfo}</div>}
          <TextInput value={draft.modelsPath || ""} onChange={(e) => set({ modelsPath: e.target.value })} placeholder={effectiveModelsPath ? `auto: ${effectiveModelsPath}` : "Models endpoint e.g. https://…/v1/models"} className="mb-1 h-8 text-xs" />
          <p className="mb-2 text-[10px] leading-relaxed text-slate-500">
            {!draft.modelsPath?.trim() && effectiveModelsPath ? (
              <>
                Leave blank to use the standard OpenAI-compatible path —{" "}
                <span className="font-mono text-slate-400">{effectiveModelsPath}</span>. Fetching classifies every
                model it finds as vision or text and free or paid from the provider&apos;s own metadata, falling back
                to the model name where none is given.
              </>
            ) : !effectiveModelsPath ? (
              <>This provider does not speak HTTP — WebLLM, Local GGUF and Puter carry fixed model lists.</>
            ) : (
              <>Overrides the automatic path. Fetching keeps your curated labels and adds anything new.</>
            )}
          </p>
          <div className="space-y-2">
            {draft.models.map((m, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <TextInput value={m.id} onChange={(e) => setModel(i, { id: e.target.value })} placeholder="model-id" className="h-8 flex-1 text-xs" />
                <TextInput value={m.label || ""} onChange={(e) => setModel(i, { label: e.target.value })} placeholder="Label" className="h-8 w-32 text-xs" />
                <label className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-400"><input type="checkbox" checked={m.vision} onChange={(e) => setModel(i, { vision: e.target.checked })} className="accent-violet-500" /> vision</label>
                <label className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-400"><input type="checkbox" checked={!!m.free} onChange={(e) => setModel(i, { free: e.target.checked })} className="accent-emerald-500" /> free</label>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-300" onClick={() => removeModel(i)}>✕</Button>
              </div>
            ))}
            {draft.models.length === 0 && <p className="text-xs text-slate-500">No models yet.</p>}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Default vision model"><Select value={draft.visionDefault || ""} onChange={(e) => set({ visionDefault: e.target.value })}><option value="">— none —</option>{draft.models.filter((m) => m.vision).map((m) => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}</Select></Field>
            <Field label="Default text model"><Select value={draft.textDefault || ""} onChange={(e) => set({ textDefault: e.target.value })}><option value="">— none —</option>{draft.models.map((m) => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}</Select></Field>
          </div>
        </div>

        <Field label="Description / notes"><TextArea value={draft.description || ""} onChange={(e) => set({ description: e.target.value })} rows={2} /></Field>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={test} disabled={testing}>{testing ? <Spinner /> : "🔌 Test connection"}</Button>
          {testResult && <span className={"text-xs " + (testResult.startsWith("✓") ? "text-emerald-300" : "text-rose-300")}>{testResult}</span>}
        </div>
      </div>
    </Modal>
  );
}
