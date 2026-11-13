import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ConversionMode, ConvertResult } from "@/types";
import { useStore } from "@/store";
import { convertImageToLatex } from "@/lib/llm";
import { parseExpressions, latexToMathml, verifyLatex } from "@/lib/mathRender";
import { fileToDataUrl, uid } from "@/lib/utils";
import { Button, Select } from "./ui";
import { ResultCard } from "./ResultCard";
import { ScreenSnip } from "./ScreenSnip";
import { runLocalOCR } from "@/lib/localOcr";

const MODES: { id: ConversionMode; label: string; hint: string }[] = [
  { id: "expression", label: "Expression", hint: "Each math expression on its own line (recommended)" },
  { id: "lines", label: "Line-by-line", hint: "One expression per visual line" },
  { id: "mixed", label: "Mixed text+math", hint: "Preserve full page layout & surrounding text" },
];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

async function compress(file: File): Promise<string> {
  const raw = await fileToDataUrl(file);
  if (!file.type.startsWith("image/")) return raw;
  try {
    const img = await loadImage(raw);
    const maxDim = 1680;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    if (scale >= 1 && file.size < 1_400_000) return raw;
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    const ctx = c.getContext("2d");
    if (!ctx) return raw;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.92);
  } catch {
    return raw;
  }
}

// Deduplicate by file signature (name+size+lastModified) to prevent double-queue on drag+input events
const seenFiles = new Set<string>();
function fileSig(f: File): string {
  return `${f.name}|${f.size}|${(f as any).lastModified || 0}`;
}

export function ConvertTab({
  results,
  setResults,
  onExport,
  onEditInLatex,
  onEditInMathType,
  desktopCaptures,
  onDesktopCaptureConsumed,
}: {
  desktopCaptures?: Array<{id:string;dataUrl:string;fileName:string}>;
  onDesktopCaptureConsumed?: (id:string) => void;
  results: ConvertResult[];
  setResults: Dispatch<SetStateAction<ConvertResult[]>>;
  onExport: () => void;
  onEditInLatex?: (resultId: string, exprIndex: number) => void;
  onEditInMathType?: (resultId: string, exprIndex: number) => void;
}) {
  const { activeProvider, activeModelId, settings, isVision, setActiveProvider, updateSettings, pushToast } = useStore();
  const [mode, setMode] = useState<ConversionMode>("expression");
  const [instruction, setInstruction] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [batchConcurrency, setBatchConcurrency] = useState<number>(settings.concurrency);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const importCountRef = useRef(0);
  const [importRevision, setImportRevision] = useState(0);
  const autoStartedIds = useRef(new Set<string>());

  const update = useCallback(
    (id: string, patch: Partial<ConvertResult>) => {
      setResults((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    },
    [setResults],
  );

  // ---- add files (images) ----
  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files).filter((f) => {
        if (!f.type.startsWith("image/") && !/\.(png|jpe?g|webp|gif|avif|bmp|tiff?|svg)$/i.test(f.name)) return false;
        const sig = fileSig(f);
        if (seenFiles.has(sig)) return false;
        seenFiles.add(sig);
        if (seenFiles.size > 1200) {
          const it = seenFiles.values().next();
          if (!it.done) seenFiles.delete(it.value);
        }
        return true;
      });
      if (!arr.length) return;
      importCountRef.current += 1;
      try {
        const chunkSize = 16;
        for (let i = 0; i < arr.length; i += chunkSize) {
          const slice = arr.slice(i, i + chunkSize);
          const part = await Promise.all(slice.map(async (f) => ({
            id: uid("img"),
            fileName: (f as any).webkitRelativePath || f.name || "image.png",
            dataUrl: await compress(f),
            status: "pending" as const,
            expressions: [],
            mathml: [],
            createdAt: Date.now(),
            mode,
          })));
          setResults((prev) => [...part, ...prev]);
          await new Promise((r) => setTimeout(r, 0));
        }
        if (arr.length >= 50) {
          setError("Loaded " + arr.length + " images. Desktop auto-conversion will start when import finishes. Concurrency: " + batchConcurrency + ".");
          setTimeout(() => setError(""), 5000);
        }
      } finally {
        importCountRef.current = Math.max(0, importCountRef.current - 1);
        if (importCountRef.current === 0) setImportRevision(v => v + 1);
      }
    },
    [mode, setResults, batchConcurrency],
  );

  // Native screenshots and native file-dialog imports enter the same deduplicated
  // image queue. The parent removes each item after it has been queued.
  useEffect(() => {
    if (!desktopCaptures?.length) return;
    let cancelled = false;
    (async () => {
      for (const capture of desktopCaptures) {
        if (cancelled) return;
        try {
          const response = await fetch(capture.dataUrl);
          const blob = await response.blob();
          const file = new File([blob], capture.fileName || "mathorium-snip.png", { type: blob.type || "image/png", lastModified: Date.now() });
          if (!cancelled) await addFiles([file]);
        } catch (error) {
          setError("Could not import " + capture.fileName + ": " + (error instanceof Error ? error.message : String(error)));
        } finally {
          if (!cancelled) onDesktopCaptureConsumed?.(capture.id);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [desktopCaptures, addFiles, onDesktopCaptureConsumed]);

  // paste from clipboard
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const it of items) {
        if (it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault();
        addFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  // ---- processing engine ----
  const processIds = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    setError("");
    // Three explicit engine modes (Settings → Conversion engine):
    //   local — Pix2Text only, never touches the network
    //   cloud — cloud vision only, Pix2Text is skipped
    //   both  — Pix2Text first, cloud vision as fallback
    const engine = window.mathoriumDesktop?.isDesktop ? "local" : settings.convertEngine;
    const useLocal = engine === "local" || engine === "both";
    const useCloud = engine === "cloud" || engine === "both";
    // A non-vision cloud model only blocks us when cloud is the sole reader.
    if (engine === "cloud" && !isVision) {
      setError(`"${activeModelId}" on ${activeProvider.name} is not vision-capable. Select a model marked "Vision" to read math from images, or switch the conversion engine to Local / Both in Settings.`);
      return;
    }
    setRunning(true);
    setProgress({ done: 0, total: ids.length, failed: 0 });
    const ac = new AbortController();
    abortRef.current = ac;

    let done = 0, failed = 0;
    const queue = [...ids];

    const worker = async () => {
      while (queue.length && !ac.signal.aborted) {
        const id = queue.shift()!;
        let item: ConvertResult | undefined;
        setResults((prev) => {
          item = prev.find((r) => r.id === id);
          return prev;
        });
        await new Promise((r) => setTimeout(r, 2));
        if (!item) { done++; continue; }
        update(id, { status: "running", error: undefined });
        let attempt = 0;
        let success = false;
        let lastMsg = "";
        // Reported separately from cloud errors: when local OCR fails we must not
        // let a later Puter/cloud message overwrite the real local cause.
        let localErrMsg = "";
        // Local-only is deterministic and offline: retrying re-runs the identical
        // greedy decode, so one attempt is all that can ever be informative.
        const maxAttempts = engine === "local" ? 1 : 3;
        while (attempt < maxAttempts && !success && !ac.signal.aborted) {
          attempt++;
          try {
            // v6: Pix2Text MFR runs fully offline and is the best math OCR available
            // here, so it goes first when enabled. Only try it on attempt 1 — it is
            // deterministic (greedy decode), so retrying it would produce the exact
            // same output and just burn seconds.
            if (useLocal && attempt === 1) {
              try {
                update(id, { status: "running", error: undefined });
                const localResult = await runLocalOCR(item.dataUrl, {
                  model: settings.localOCRModel,
                  signal: ac.signal,
                  repair: settings.pix2textRepair,
                  quality: settings.recognitionQuality,
                });
                const rawText = (localResult.text || "").trim();
                if (rawText) {
                  // Pix2Text emits LaTeX directly; wrap so the parser sees a math block.
                  const expressions = parseExpressions("<math>" + rawText + "</math>", mode);
                  const finalExprs = expressions.length ? expressions : [rawText];
                  if (settings.verifyLatex) {
                    finalExprs.forEach((e, i) => {
                      const v = verifyLatex(e);
                      if (v.cleaned) finalExprs[i] = v.cleaned;
                    });
                  }
                  update(id, {
                    status: "done",
                    raw: rawText,
                    expressions: finalExprs,
                    originalExpressions: finalExprs.slice(),
                    mathml: finalExprs.map((e) => latexToMathml(e, true)),
                    error: undefined,
                    provider: "local",
                    model: localResult.model,
                    attempts: attempt,
                    repairs: localResult.repairs,
                  });
                  success = true;
                  continue;
                }
                localErrMsg = "Local OCR returned an empty result.";
              } catch (localErr: any) {
                if (ac.signal.aborted) throw localErr;
                localErrMsg = localErr?.message || "unknown error";
                console.warn("Local OCR failed:", localErrMsg);
              }
            }

            // If engine is "local" only, a local failure is final — no cloud fallback.
            if (engine === "local") {
              throw new Error(
                `Local OCR failed: ${localErrMsg || "no result"}. Cloud vision is disabled (engine is set to Local only in Settings). Switch to Both or Cloud to enable cloud fallback.`,
              );
            }

            // Cloud path (engine "cloud" or "both").
            if (!useCloud) {
              // Engine was "local" and we already threw above, so this is unreachable.
              // But TypeScript doesn't know that, so guard it explicitly.
              throw new Error("No OCR engine enabled.");
            }
            if (!isVision) {
              // The gate at the top already blocked pure-cloud + non-vision, so this
              // can only fire when engine is "both" and local just failed.
              throw new Error(
                `Local OCR failed (${localErrMsg || "no result"}), and "${activeModelId}" on ${activeProvider.name} cannot read images. Select a vision model to enable cloud fallback.`,
              );
            }

            // Records who actually answered. On a fallback these differ from the
            // selected provider/model, and the result card must credit the engine
            // that really produced the LaTeX.
            let usedProvider = activeProvider.id;
            let usedModel = activeModelId;
            let raw = await convertImageToLatex({
              provider: activeProvider,
              model: activeModelId,
              settings,
              dataUrl: item.dataUrl,
              mode,
              userInstruction: instruction,
              signal: ac.signal,
              onProviderSwitch: (pid, reason, modelId) => {
                usedProvider = pid;
                if (modelId) usedModel = modelId;
                pushToast({
                  title: modelId ? `Auto-switched to ${pid} · ${modelId}` : `Auto-switched to ${pid}`,
                  description: reason,
                  tone: "info",
                  duration: 5000,
                });
              },
            });
            let expressions = parseExpressions(raw, mode);

            // Multi-pass: run again and pick result with more expressions
            if (settings.multiPass && expressions.length > 0 && !ac.signal.aborted) {
              try {
                let pass2Provider = activeProvider.id;
                let pass2Model = activeModelId;
                const raw2 = await convertImageToLatex({
                  provider: activeProvider,
                  model: activeModelId,
                  settings,
                  dataUrl: item.dataUrl,
                  mode,
                  userInstruction: instruction,
                  signal: ac.signal,
                  onProviderSwitch: (pid, _reason, modelId) => {
                    pass2Provider = pid;
                    if (modelId) pass2Model = modelId;
                  },
                });
                const expressions2 = parseExpressions(raw2, mode);
                if (expressions2.length > expressions.length) {
                  raw = raw2;
                  expressions = expressions2;
                  // The winning pass came from pass 2, so its engine is the one
                  // that produced the result being kept.
                  usedProvider = pass2Provider;
                  usedModel = pass2Model;
                }
              } catch {
                /* ignore second-pass failure */
              }
            }

            // v4: Verify & clean each expression
            if (settings.verifyLatex) {
              expressions = expressions.map((e) => {
                const v = verifyLatex(e);
                return v.cleaned || e;
              }).filter(Boolean);
            }

            update(id, {
              status: "done",
              raw,
              expressions,
              originalExpressions: expressions.slice(),
              mathml: expressions.map((e) => latexToMathml(e, true)),
              error: expressions.length ? undefined : "No math expressions detected.",
              provider: usedProvider,
              model: usedModel,
              attempts: attempt,
            });
            success = true;
          } catch (e: unknown) {
            lastMsg = e instanceof Error ? e.message : String(e);
            if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 650 * attempt));
          }
        }
        if (!success) {
          failed++;
          // Say what actually happened per engine mode. Previously the cloud error
          // (typically a Puter init message) silently replaced the local one, so a
          // LOCAL OCR item showed an unrelated cloud failure.
          let msg: string;
          if (engine === "local") {
            msg = lastMsg || localErrMsg || "Local OCR failed.";
          } else if (engine === "cloud") {
            msg = lastMsg || "Cloud conversion failed after 3 attempts";
          } else {
            const cloudMsg = lastMsg || "Cloud conversion failed after 3 attempts";
            msg = localErrMsg
              ? `Local OCR failed: ${localErrMsg} · Cloud fallback also failed: ${cloudMsg}`
              : cloudMsg;
          }
          update(id, { status: "error", error: msg });
        }
        done++;
        setProgress({ done, total: ids.length, failed });
      }
    };

    const conc = window.mathoriumDesktop?.isDesktop ? 1 : Math.min(Math.max(1, batchConcurrency), ids.length, 8);
    await Promise.all(Array.from({ length: conc }, () => worker()));
    setRunning(false);
    abortRef.current = null;
  }, [activeModelId, activeProvider, instruction, isVision, mode, settings, update, setResults, batchConcurrency, pushToast]);

  // Desktop imports auto-start once the full import operation is complete.
  // Each ID is started at most once automatically; explicit retries remain manual.
  useEffect(() => {
    if (!window.mathoriumDesktop?.isDesktop || !settings.autoConvertAfterImport || running || importCountRef.current !== 0 || importRevision === 0) return;
    const ids = results.filter((r) => r.status === "pending" && !autoStartedIds.current.has(r.id)).map((r) => r.id);
    if (!ids.length) return;
    ids.forEach((id) => autoStartedIds.current.add(id));
    const timer = window.setTimeout(() => { void processIds(ids); }, 20);
    return () => window.clearTimeout(timer);
  }, [importRevision, results, running, processIds, settings.autoConvertAfterImport]);

  const processPending = useCallback(() => {
    const pending = results.filter((r) => r.status === "pending").map((r) => r.id);
    if (pending.length) processIds(pending);
  }, [results, processIds]);

  const processFailed = useCallback(() => {
    const failedIds = results.filter((r) => r.status === "error").map((r) => r.id);
    if (!failedIds.length) return;
    setResults((prev) =>
      prev.map((r) => (failedIds.includes(r.id) ? { ...r, status: "pending", error: undefined } : r)),
    );
    setTimeout(() => processIds(failedIds), 40);
  }, [results, processIds, setResults]);

  const rerun = useCallback(
    (id: string) => {
      update(id, { status: "pending", expressions: [], mathml: [], error: undefined });
      setTimeout(() => processIds([id]), 30);
    },
    [update, processIds],
  );

  const remove = useCallback((id: string) => setResults((prev) => prev.filter((r) => r.id !== id)), [setResults]);
  const clearAll = useCallback(() => {
    seenFiles.clear();
    setResults([]);
  }, [setResults]);

  const pendingCount = results.filter((r) => r.status === "pending").length;
  const doneCount = results.filter((r) => r.status === "done").length;
  const failedCount = results.filter((r) => r.status === "error").length;
  const runningCount = results.filter((r) => r.status === "running" || r.status === "queued").length;

  const onFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) addFiles(e.target.files);
    e.target.value = "";
  };

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/8 bg-[var(--surface-card)] p-3">
        <div className="flex items-center gap-1 rounded-xl bg-black/30 p-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              title={m.hint}
              className={
                "rounded-lg px-3 py-1.5 text-xs font-medium transition " +
                (mode === m.id ? "bg-gradient-to-br from-violet-500 to-indigo-600 text-on-accent shadow" : "text-slate-400 hover:text-white")
              }
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 pl-2 text-[11px] text-slate-500">
          <span>concurrency</span>
          <input
            type="number"
            min={1}
            max={8}
            value={batchConcurrency}
            onChange={(e) => setBatchConcurrency(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
            className="w-12 rounded-md border border-white/10 bg-[var(--surface-well)] px-1 py-0.5 text-center text-slate-200"
          />
        </div>

        {/* Which engine will actually read the images — visible without opening Settings. */}
        <div
          className={
            "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] " +
            (settings.convertEngine === "local"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : settings.convertEngine === "cloud"
                ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
                : "border-cyan-500/30 bg-cyan-500/10 text-cyan-300")
          }
          title={
            settings.convertEngine === "local"
              ? "Local only — Pix2Text on-device, no network. Change in Settings."
              : settings.convertEngine === "cloud"
                ? "Cloud only — images go to the selected vision model. Change in Settings."
                : "Both — Pix2Text first, cloud vision as fallback. Change in Settings."
          }
        >
          {settings.convertEngine === "local" ? "🔬 Local only" : settings.convertEngine === "cloud" ? "☁ Cloud only" : "🔬+☁ Local → Cloud"}
        </div>

        {/* Post-process toggle. Only shown when the offline engine can actually run,
            because repair operates on Pix2Text's decoder output — a cloud vision model
            returns LaTeX that was never denormalized this way and is left untouched. */}
        {settings.convertEngine !== "cloud" && (
          <button
            onClick={() => updateSettings({ pix2textRepair: !settings.pix2textRepair })}
            aria-pressed={settings.pix2textRepair}
            className={
              "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition-colors " +
              (settings.pix2textRepair
                ? "border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20"
                : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10")
            }
            title={
              settings.pix2textRepair
                ? "Post-process ON — repairs the offline engine's output: brackets read as the wrong shape, doubled braces, spaced operator names, TeX 2.09 font switches. Click to turn off."
                : "Post-process OFF — offline results are shown exactly as the decoder produced them. Click to turn on."
            }
          >
            {settings.pix2textRepair ? "✨ Post-process on" : "○ Post-process off"}
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {running ? (
            <Button variant="danger" size="sm" onClick={() => abortRef.current?.abort()}>■ Stop ({runningCount})</Button>
          ) : (
            <>
              <Button variant="primary" size="sm" disabled={!pendingCount} onClick={processPending}>
                ▶ Convert{pendingCount ? ` (${pendingCount})` : ""}
              </Button>
              <Button variant="outline" size="sm" disabled={!failedCount} onClick={processFailed} title="Re-run only failed images">
                ↻ Retry failed{failedCount ? ` (${failedCount})` : ""}
              </Button>
            </>
          )}
          <Button variant="success" size="sm" disabled={!doneCount} onClick={onExport}>⤓ Export</Button>
          {results.length > 0 && <Button variant="ghost" size="sm" onClick={clearAll}>Clear</Button>}
        </div>
      </div>

      {/* status row */}
      {results.length > 0 && (
        <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
          <span className="rounded-full bg-white/5 px-2 py-1">total {results.length}</span>
          <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-300">done {doneCount}</span>
          <span className="rounded-full bg-sky-500/10 px-2 py-1 text-sky-300">pending {pendingCount}</span>
          {runningCount > 0 && <span className="rounded-full bg-violet-500/10 px-2 py-1 text-violet-300">running {runningCount}</span>}
          {failedCount > 0 && <span className="rounded-full bg-rose-500/10 px-2 py-1 text-rose-300">failed {failedCount}</span>}
        </div>
      )}

      {/* advanced instruction */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">Extra instruction (optional):</span>
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder='e.g. "Output matrix entries left-aligned" or "Also describe the steps"'
          className="h-8 flex-1 min-w-[200px] rounded-lg border border-white/10 bg-[var(--surface-well)] px-3 text-xs text-slate-200 placeholder:text-slate-600 focus:border-violet-400/50 focus:outline-none"
        />
        <Select value={mode} onChange={(e) => setMode(e.target.value as ConversionMode)} className="h-8 w-auto py-0 text-xs">
          {MODES.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </Select>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
          <div className="text-sm text-amber-200">{error}</div>
          {/401|Unauthorized|Authentication/i.test(error) && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-amber-300/80">Tip: read the image with no key at all.</span>
              {/* The bundled engine is the only genuinely zero-key OCR path — it
                  needs no account, no network and no sign-in, so it is offered
                  first. Puter is keyless in principle but its anonymous session
                  may ask for sign-in, so it is the second suggestion.
                  `offlineEnabled` is set alongside the engine because with the
                  Offline master switch off, updateSettings coerces a "local"
                  engine straight back to "cloud" — setting the engine alone
                  would look like a no-op click. */}
              <button
                onClick={() => updateSettings({ convertEngine: "local", offlineEnabled: true })}
                className="rounded-lg bg-emerald-500 px-3 py-1.5 font-semibold text-on-accent hover:bg-emerald-400"
              >
                → Use offline Pix2Text · no key, no network
              </button>
              <button
                onClick={() => setActiveProvider("puter")}
                className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-emerald-200 hover:bg-emerald-400/20"
              >
                Try Puter cloud vision
              </button>
              <a
                href="https://enter.pollinations.ai"
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-amber-200 hover:bg-amber-400/20"
              >
                Get a free Pollinations key
              </a>
            </div>
          )}
        </div>
      )}

      {/* progress */}
      {running && (
        <div className="rounded-xl border border-white/8 bg-[var(--surface-card)] p-3">
          <div className="mb-1.5 flex justify-between text-xs text-slate-400">
            <span>Processing batch… {progress.failed ? `(${progress.failed} failed – auto-retry x3)` : ""}</span>
            <span>{progress.done}/{progress.total}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/8">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      {/* screen snip — capture maths that only exists on screen (PDF viewers,
          video lectures, other apps) instead of making the user save a file first */}
      <ScreenSnip onImages={addFiles} />

      {/* dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
          const items = e.dataTransfer.items;
          if (items) {
            const files: File[] = [];
            const readEntry = (entry: any, path = "") => {
              if (entry.isFile) {
                entry.file((f: File) => {
                  Object.defineProperty(f, "webkitRelativePath", { value: path + f.name, writable: false });
                  files.push(f);
                });
              } else if (entry.isDirectory) {
                const reader = entry.createReader();
                reader.readEntries((entries: any[]) => entries.forEach((en) => readEntry(en, path + entry.name + "/")));
              }
            };
            for (let i = 0; i < items.length; i++) {
              const ent = (items[i] as any).webkitGetAsEntry?.();
              if (ent) readEntry(ent, "");
            }
            setTimeout(() => files.length && addFiles(files), 380);
          }
        }}
        className={
          "rounded-2xl border-2 border-dashed p-8 text-center transition " +
          (dragging ? "border-violet-400 bg-violet-500/5" : "border-white/12 bg-[var(--surface-panel)]")
        }
      >
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/20 to-indigo-500/20 text-2xl">🖼️</div>
        <div className="text-sm font-medium text-slate-200">Drop math images or a whole folder here · paste (Ctrl+V) · snip your screen above · or</div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <Button variant="primary" size="sm" onClick={() => inputRef.current?.click()}>＋ Add images</Button>
          <Button variant="subtle" size="sm" onClick={() => folderRef.current?.click()}>📁 Add folder</Button>
          <span className="text-xs text-slate-500">500+ images supported · auto-retry x3 · resume failed</span>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={folderRef}
          type="file"
          // @ts-ignore
          webkitdirectory=""
          multiple
          className="hidden"
          onChange={onFolderChange}
        />
        <div className="mt-3 text-[11px] text-slate-600">Handwriting · printed · PDF screenshots · whiteboards · photos · matrices · integrals · chemistry — all supported. Batch: 500+ images, concurrency {batchConcurrency}.</div>
      </div>

      {/* results */}
      {results.length > 0 && (
        <div className="space-y-3">
          {failedCount > 10 && !running && (
            <div className="flex items-center justify-between rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
              <span>{failedCount} images failed — likely rate-limit / timeout.</span>
              <Button size="sm" variant="danger" onClick={processFailed}>↻ Retry failed ({failedCount})</Button>
            </div>
          )}
          {results.map((r, i) => (
            <ResultCard key={r.id} result={r} index={i} onUpdate={update} onRemove={remove} onRerun={rerun} onEditInLatex={onEditInLatex} onEditInMathType={onEditInMathType} />
          ))}
        </div>
      )}
    </div>
  );
}
