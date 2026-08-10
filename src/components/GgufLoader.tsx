import { useCallback, useEffect, useRef, useState } from "react";
import {
  classifyFiles,
  getGGUFModelInfo,
  isGGUFSupported,
  isMultiThreadAvailable,
  loadGGUFModel,
  sizeWarning,
  unloadGGUF,
  type GGUFModelInfo,
} from "@/lib/ggufClient";
import { Badge, Button, Field, Select } from "./ui";

const CONTEXT_CHOICES = [2048, 4096, 8192, 16384];

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(2)} GB`;

/**
 * Picks a .gguf file off disk and loads it into the in-browser llama.cpp runtime.
 *
 * The model is never uploaded and never persisted: browsers hand out a `File`
 * handle, not a path, so nothing here survives a reload. That is stated in the UI
 * rather than hidden, because a multi-gigabyte load that silently has to be redone
 * every session is worse as a surprise than as a documented cost.
 */
export function GgufLoader() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [info, setInfo] = useState<GGUFModelInfo | null>(() => getGGUFModelInfo());
  const [picked, setPicked] = useState<File[]>([]);
  const [contextSize, setContextSize] = useState(4096);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ fraction: number; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A load can outlive this component if the user switches tabs mid-way; the
  // callbacks must not write into an unmounted tree.
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const supported = isGGUFSupported();
  const { model, mmproj } = classifyFiles(picked);
  const warning = picked.length ? sizeWarning(picked) : null;

  const onPick = useCallback((files: FileList | null) => {
    setError(null);
    if (!files?.length) return;
    const list = Array.from(files).filter((f) => f.name.toLowerCase().endsWith(".gguf"));
    if (!list.length) {
      setError("That is not a .gguf file. Quantised llama.cpp models use the .gguf extension.");
      return;
    }
    setPicked(list);
  }, []);

  const load = useCallback(async () => {
    if (!picked.length) return;
    setBusy(true);
    setError(null);
    setProgress({ fraction: 0, status: "Preparing…" });
    try {
      const loaded = await loadGGUFModel(picked, {
        contextSize,
        onProgress: (fraction, status) => {
          if (alive.current) setProgress({ fraction, status });
        },
      });
      if (alive.current) setInfo(loaded);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) {
        setBusy(false);
        setProgress(null);
      }
    }
  }, [picked, contextSize]);

  const unload = useCallback(async () => {
    setBusy(true);
    await unloadGGUF();
    if (alive.current) {
      setInfo(null);
      setPicked([]);
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, []);

  return (
    <section className="space-y-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-emerald-200">Local GGUF · run your own model</h3>
        <Badge tone="green">new</Badge>
        {info && <Badge tone="green">loaded</Badge>}
        {info?.vision && <Badge tone="blue">👁 vision</Badge>}
      </div>

      <p className="text-[11px] leading-relaxed text-slate-400">
        llama.cpp compiled to WebAssembly. Pick any <code className="rounded bg-black/40 px-1">.gguf</code> file
        from your disk — Qwen3-VL, Llama, Mistral, Phi, Gemma — and it runs entirely inside this tab. No upload,
        no API key, no GPU required. Select the model&apos;s{" "}
        <code className="rounded bg-black/40 px-1">mmproj-*.gguf</code> at the same time to enable image input on
        vision models. Then choose <strong className="text-slate-300">Local GGUF</strong> as your provider.
      </p>

      {!supported && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          This browser has no WebAssembly support, so local models cannot run here.
        </div>
      )}

      {info ? (
        <div className="space-y-2 rounded-xl border border-white/10 bg-[var(--surface-well)] p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-mono text-xs text-emerald-200" title={info.name}>{info.name}</div>
              <div className="text-[11px] text-slate-500">
                {gb(info.size)} · {info.contextSize.toLocaleString()} token context ·{" "}
                {info.vision ? "image input enabled" : "text only"}
              </div>
            </div>
            <Button size="sm" variant="ghost" className="text-rose-300" disabled={busy} onClick={unload}>
              Unload
            </Button>
          </div>
          <div className="text-[11px] text-slate-500">
            Loaded in memory only — reloading the page clears it and the file must be picked again.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <input
            ref={inputRef}
            type="file"
            accept=".gguf"
            multiple
            disabled={!supported || busy}
            onChange={(e) => onPick(e.target.files)}
            className="w-full cursor-pointer rounded-xl border border-white/10 bg-[var(--surface-well)] px-3 py-2 text-xs text-slate-300 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-emerald-500/20 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-emerald-200 hover:file:bg-emerald-500/30 disabled:opacity-40"
          />

          {picked.length > 0 && (
            <div className="space-y-1 rounded-xl border border-white/10 bg-[var(--surface-well)] p-3 text-[11px]">
              {model.map((f) => (
                <div key={f.name} className="flex items-center justify-between gap-3">
                  <span className="truncate font-mono text-slate-300" title={f.name}>{f.name}</span>
                  <span className="shrink-0 text-slate-500">{gb(f.size)}</span>
                </div>
              ))}
              {mmproj && (
                <div className="flex items-center justify-between gap-3 border-t border-white/8 pt-1">
                  <span className="truncate font-mono text-sky-300" title={mmproj.name}>
                    👁 {mmproj.name}
                  </span>
                  <span className="shrink-0 text-slate-500">{gb(mmproj.size)}</span>
                </div>
              )}
            </div>
          )}

          {warning && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
              {warning}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Context window" hint="larger uses more memory">
              <Select
                value={contextSize}
                disabled={busy}
                onChange={(e) => setContextSize(Number(e.target.value))}
              >
                {CONTEXT_CHOICES.map((n) => (
                  <option key={n} value={n}>{n.toLocaleString()} tokens</option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <Button
                variant="success"
                className="w-full"
                disabled={!supported || busy || !picked.length}
                onClick={load}
              >
                {busy ? "Loading…" : "Load model"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {progress && (
        <div className="space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-emerald-400 transition-all duration-300"
              style={{ width: `${Math.round(progress.fraction * 100)}%` }}
            />
          </div>
          <div className="text-[11px] text-slate-400">{progress.status}</div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </div>
      )}

      <div className="text-[11px] text-slate-500">
        {isMultiThreadAvailable()
          ? "Multi-threaded: this page is cross-origin isolated, so all cores are in use."
          : "Single-threaded: the page is not cross-origin isolated, so generation runs on one core and will be slow. Opening the built file over http:// with COOP/COEP headers enables threads."}
      </div>
    </section>
  );
}
