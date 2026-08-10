import { useState } from "react";
import type { ConvertResult } from "@/types";
import { MathView } from "./MathView";
import { ImageZoom } from "./ImageZoom";
import { Badge, Button, Spinner } from "./ui";
import { latexToMathml } from "@/lib/mathRender";
import { repairPix2TextExpressions } from "@/lib/pix2textRepair";
import { copyText } from "@/lib/utils";

export function ResultCard({
  result,
  index,
  onUpdate,
  onRemove,
  onRerun,
  onEditInLatex,
  onEditInMathType,
}: {
  result: ConvertResult;
  index: number;
  onUpdate: (id: string, patch: Partial<ConvertResult>) => void;
  onRemove: (id: string) => void;
  onRerun: (id: string) => void;
  onEditInLatex?: (resultId: string, exprIndex: number) => void;
  /** Opens this expression on the MathType tab, alongside its source image. */
  onEditInMathType?: (resultId: string, exprIndex: number) => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const [repairRan, setRepairRan] = useState(false);
  const running = result.status === "running" || result.status === "queued";

  const setExpr = (i: number, val: string) => {
    const expressions = result.expressions.slice();
    expressions[i] = val;
    onUpdate(result.id, { expressions });
  };
  const delExpr = (i: number) => {
    onUpdate(result.id, { expressions: result.expressions.filter((_, j) => j !== i) });
  };
  const addExpr = () => onUpdate(result.id, { expressions: [...result.expressions, ""] });
  const resetExprs = () => {
    if (result.originalExpressions && result.originalExpressions.length) {
      onUpdate(result.id, {
        expressions: result.originalExpressions.slice(),
        mathml: result.originalExpressions.map((e) => latexToMathml(e, true)),
      });
    }
  };
  const isDirty = !!result.originalExpressions &&
    JSON.stringify(result.originalExpressions) !== JSON.stringify(result.expressions);

  /**
   * Apply the post-process pass to a result that has already been converted.
   *
   * Only the string-level rules run here: the delimiter-shape correction needs the
   * decoder's per-token alternatives, which exist only during recognition and are not
   * persisted. So this fixes doubled braces, operator names, font switches and letters
   * read as commands, and re-checks delimiter balance — but a bracket of the wrong
   * shape can only be recovered by re-running the image. That is what "↻ Re-run" is
   * for, and the button below says so rather than implying a fix it cannot deliver.
   *
   * Safe to press repeatedly: every rule is idempotent, so a second press is a no-op.
   */
  const applyRepair = () => {
    const rep = repairPix2TextExpressions(result.expressions);
    onUpdate(result.id, {
      expressions: rep.expressions,
      mathml: rep.expressions.map((e) => latexToMathml(e, true)),
      repairs: rep.issues,
    });
    setRepairRan(true);
  };

  // Issues the repair pass could only report — these are the ones that need the user
  // to look at the image, so they are surfaced rather than buried in a details block.
  const warnings = (result.repairs || []).filter((r) => /imbalance|surplus|uncertain/.test(r.rule));
  const applied = (result.repairs || []).filter((r) => !/imbalance|surplus|uncertain/.test(r.rule));

  const allLatex = result.expressions.filter(Boolean).join("\n");
  const allMathml = result.expressions.filter(Boolean).map((e) => latexToMathml(e, true)).join("\n");

  return (
    <div className="overflow-hidden rounded-2xl border border-white/8 bg-[var(--surface-card)]">
      <div className="flex items-center gap-3 border-b border-white/8 bg-white/[0.02] px-4 py-2.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white/8 text-xs font-semibold text-slate-300">{index + 1}</span>
        <span className="truncate text-sm font-medium text-slate-200" title={result.fileName}>{result.fileName}</span>
        <div className="ml-auto flex items-center gap-2">
          {result.provider && <Badge tone={result.provider.startsWith("local") || result.provider.includes("Pix2Text") ? "green" : "blue"}>{result.provider.includes("Pix2Text") ? "🔬 Pix2Text" : result.provider.startsWith("local") ? "🔬 Local OCR" : "☁️ " + result.provider}</Badge>}
          {/* The model that actually produced this result. Auto-rotation can answer
              from a different model than the one selected in the header, so naming
              it here is the only way the user knows what read their image. */}
          {result.model && (
            <span className="max-w-[220px] truncate text-[10px] text-slate-500" title={`Model: ${result.model}`}>
              {result.model}
            </span>
          )}
          {running && <Badge tone="blue"><Spinner className="h-3 w-3" /> {result.status}</Badge>}
          {result.status === "done" && <Badge tone="green">{result.expressions.length} expr</Badge>}
          {result.status === "error" && <Badge tone="rose">error</Badge>}
          {result.status === "pending" && <Badge>queued</Badge>}
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(340px,32%)_1fr]">
        {/* image */}
        <div className="space-y-2">
          <ImageZoom src={result.dataUrl} alt={result.fileName} heightClass="h-72 md:h-96" />
          <div className="flex gap-1.5">
            <Button size="sm" variant="subtle" className="flex-1" disabled={running} onClick={() => onRerun(result.id)}>↻ Re-run</Button>
            <Button size="sm" variant="ghost" onClick={() => onRemove(result.id)} title="Remove">✕</Button>
          </div>
        </div>

        {/* results */}
        <div className="min-w-0 space-y-3">
          {result.error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{result.error}</div>
          )}

          {!running && result.expressions.length === 0 && !result.error && (
            <div className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-sm text-slate-500">No expressions yet.</div>
          )}

          {/* Things the post-process could detect but not safely fix. Guessing a
              delimiter's shape or where a missing bracket belongs would turn a
              visible defect into an invisible one, so these are handed to the user
              next to the source image instead. */}
          {warnings.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-300/80">
                Check against the image
              </div>
              <ul className="space-y-0.5 text-xs text-amber-200">
                {warnings.map((w) => (
                  <li key={w.rule}>· {w.label}</li>
                ))}
              </ul>
            </div>
          )}

          {result.expressions.map((expr, i) => {
            const isMultiLine = /\\begin\{(gathered|aligned|align|cases|matrix|bmatrix|vmatrix|pmatrix|array|split)\*?\}/.test(expr);
            return (
            <div key={i} className="rounded-xl border border-white/10 bg-[var(--surface-well)] p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Expression {i + 1}
                  {isMultiLine && <span className="rounded-full border border-violet-400/30 bg-violet-500/15 px-1.5 py-0.5 text-[9px] normal-case text-violet-300">⛓ multi-line</span>}
                </span>
                <div className="flex gap-1">
                  {/* Visual editing is offered on every expression, not just the ones
                      that look wrong — a formula is easier to check as a formula than
                      as a string, whatever produced it. This opens the MathType tab
                      with the expression and its source image side by side, rather
                      than a dialog that would cover the very page being checked. */}
                  {onEditInMathType && (
                    <Button size="sm" variant="ghost" title="Edit visually on the MathType tab" onClick={() => onEditInMathType(result.id, i)}>∑ MathType</Button>
                  )}
                  {onEditInLatex && (
                    <Button size="sm" variant="ghost" title="Edit in LaTeX Tool" onClick={() => onEditInLatex(result.id, i)}>✎ Edit</Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => copyText(expr)} title="Copy LaTeX">⎘ LaTeX</Button>
                  <Button size="sm" variant="ghost" onClick={() => copyText(latexToMathml(expr, true))} title="Copy MathML">⎘ MathML</Button>
                  <Button size="sm" variant="ghost" className="text-rose-300" onClick={() => delExpr(i)}>✕</Button>
                </div>
              </div>
              <div className="overflow-x-auto rounded-lg bg-white/[0.03] px-3 py-2 text-lg">
                <MathView tex={expr} display />
              </div>
              <textarea
                value={expr}
                onChange={(e) => setExpr(i, e.target.value)}
                spellCheck={false}
                rows={Math.min(4, Math.max(1, expr.split("\n").length))}
                className="mt-2 w-full resize-y rounded-lg border border-white/10 bg-[var(--surface-sunken)] px-2.5 py-1.5 font-mono text-xs text-sky-200 focus:border-violet-400/50 focus:outline-none"
                placeholder="Edit LaTeX…"
              />
            </div>
            );
          })}

          {!running && (
            <Button size="sm" variant="subtle" onClick={addExpr}>+ Add expression</Button>
          )}

          {result.expressions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-t border-white/8 pt-3">
              <Button size="sm" variant="outline" onClick={() => copyText(allLatex)}>Copy all LaTeX</Button>
              <Button size="sm" variant="outline" onClick={() => copyText(allMathml)}>Copy all MathML</Button>
              <Button size="sm" variant="ghost" disabled={!isDirty} title={isDirty ? "Restore original converted output" : "No edits to reset"} onClick={resetExprs}>↺ Reset</Button>
              {/* Post-process on demand, for results converted with the toggle off or
                  edited by hand since. Idempotent, so pressing it twice changes nothing. */}
              <Button
                size="sm"
                variant="ghost"
                disabled={running}
                onClick={applyRepair}
                title="Clean up this LaTeX: doubled braces, spaced operator names, TeX 2.09 font switches, letters read as commands. Bracket shapes can only be corrected by re-running the image."
              >
                {repairRan ? "✨ Post-processed" : "✨ Post-process"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowRaw((v) => !v)}>{showRaw ? "Hide" : "Show"} raw</Button>
            </div>
          )}

          {/* What repair actually changed — collapsed into one quiet line, since a
              successful fix needs no attention, unlike the warnings above. */}
          {applied.length > 0 && (
            <div className="text-[11px] text-slate-500">
              ✨ {applied.map((a) => `${a.label}${a.count > 1 ? ` ×${a.count}` : ""}`).join(" · ")}
            </div>
          )}

          {showRaw && result.raw && (
            <pre className="max-h-56 overflow-auto rounded-lg border border-white/10 bg-[var(--surface-sunken)] p-3 text-[11px] leading-relaxed text-slate-400">{result.raw}</pre>
          )}
        </div>
      </div>

    </div>
  );
}
