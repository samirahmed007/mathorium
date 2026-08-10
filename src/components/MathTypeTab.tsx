import {
  useCallback, useEffect, useMemo, useRef, useState,
  type ClipboardEvent as ReactClipboardEvent, type Dispatch, type SetStateAction,
} from "react";
import type { ConvertResult } from "@/types";
import { MathView } from "./MathView";
import { ImageZoom } from "./ImageZoom";
import { Badge, Button, Select, Spinner } from "./ui";
import { IconBtn, Label, Menu, PaletteButton, Ribbon } from "./mathTypeParts";
import { MatrixBuilder } from "./MatrixBuilder";
import { useMathfield } from "@/hooks/useMathfield";
import { useUndoable, undoRedoIntent } from "@/hooks/useUndoable";
import { latexToMathml } from "@/lib/mathRender";
import { copyText, download } from "@/lib/utils";
import { clipboardToLatex } from "@/lib/smartPaste";
import { readMathfield } from "@/lib/mathlive";
import { SHORTCUTS, SYMBOL_GROUPS, TEMPLATE_GROUPS, TEMPLATE_TABS, shortcutLabel } from "@/lib/mathTypePalettes";
import { cn } from "@/utils/cn";

/**
 * MathTypeTab — the MathType editor as a workspace of its own, the same way the LaTeX
 * tool has one.
 *
 * The pop-over editor is right for a quick correction from a result card, but wrong for
 * the work this tab is for: sitting with a scanned page, comparing formula against
 * glyphs, and typing a long derivation. A dialog constrains that to a fraction of the
 * viewport and puts a backdrop between the user and everything else. So this is a plain
 * page — full-height editing surface, source image alongside, and an optional link to a
 * converted expression so edits can be written back where exports will pick them up.
 */

type Panel = "split" | "visual" | "latex";
type Target = { resultId: string; exprIndex: number } | null;

const EXAMPLES: { label: string; tex: string }[] = [
  { label: "Quadratic", tex: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}" },
  { label: "Matrix", tex: "\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}" },
  { label: "Integral", tex: "\\int_{0}^{\\infty} e^{-x^{2}}\\,dx = \\frac{\\sqrt{\\pi}}{2}" },
  { label: "Sum", tex: "\\sum_{n=1}^{\\infty} \\frac{1}{n^{2}} = \\frac{\\pi^{2}}{6}" },
  { label: "Piecewise", tex: "f(x) = \\begin{cases} x^{2} & x \\geq 0 \\\\ -x & x < 0 \\end{cases}" },
  { label: "Aligned", tex: "\\begin{aligned} (a+b)^2 &= a^2+2ab+b^2 \\\\ &= a^2+b^2+2ab \\end{aligned}" },
  { label: "Einstein", tex: "R_{\\mu\\nu} - \\tfrac{1}{2}R g_{\\mu\\nu} = \\frac{8\\pi G}{c^{4}} T_{\\mu\\nu}" },
];

export function MathTypeTab({
  results,
  setResults,
  target: targetProp,
  setTarget: setTargetProp,
  seed,
  onSeedConsumed,
}: {
  results?: ConvertResult[];
  setResults?: Dispatch<SetStateAction<ConvertResult[]>>;
  /**
   * Which converted expression to open, set by "∑ MathType" on a result card. Lifted to
   * the shell because the tab unmounts when you navigate away from it — local state
   * would forget the link the moment the user went back to Convert to pick another one.
   */
  target?: Target;
  setTarget?: Dispatch<SetStateAction<Target>>;
  /** An unlinked expression to load, sent from the LaTeX tab. Cleared once taken. */
  seed?: string | null;
  onSeedConsumed?: () => void;
}) {
  /**
   * One history for the whole tab. Both panes are views of the same string, so Ctrl+Z
   * means "undo my last edit" wherever it came from — the mathfield, the LaTeX box, or
   * a palette click. MathLive's own stack cannot see the other two.
   */
  const doc = useUndoable(EXAMPLES[0].tex);
  const latex = doc.value;
  const setLatex = doc.set;
  const [panel, setPanel] = useState<Panel>("split");
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [tab, setTab] = useState(TEMPLATE_TABS[0].name);
  const [zoom, setZoom] = useState(150);
  const [kbd, setKbd] = useState(false);
  const [showMathml, setShowMathml] = useState(false);
  const [note, setNote] = useState("");
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [matrixBtn, setMatrixBtn] = useState<HTMLButtonElement | null>(null);

  // Fall back to local state when the shell does not supply the link, so the tab still
  // works standalone (and in isolation, in a test).
  const [ownTarget, setOwnTarget] = useState<Target>(null);
  const target = targetProp !== undefined ? targetProp : ownTarget;
  const setTarget = setTargetProp ?? setOwnTarget;

  const {
    hostRef, mfRef, ready, loadError, status,
    insert: insertRaw, cmd: runCmd, smartPaste, pasteNote, setPasteNote,
  } = useMathfield({
    enabled: panel !== "latex",
    value: latex,
    onChange: setLatex,
  });

  const insert = useCallback((tex: string) => { insertRaw(tex); setOpenGroup(null); }, [insertRaw]);
  const cmd = useCallback((name: string) => { runCmd(name); setOpenMenu(null); }, [runCmd]);
  const paste = useCallback(() => { void smartPaste(); setOpenMenu(null); }, [smartPaste]);

  /**
   * Paste into the LaTeX pane. The textarea gets the same treatment as the mathfield —
   * MathML, rendered maths and delimited LaTeX all become plain LaTeX — because which
   * pane the caret happens to be in should not change what a paste does.
   */
  const onPasteLatex = useCallback((e: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const result = clipboardToLatex(e.clipboardData.getData("text/html"), e.clipboardData.getData("text/plain"));
    if (!result?.latex.trim() || result.kind === "latex") return; // nothing to improve on
    e.preventDefault();
    const ta = e.currentTarget;
    const next = latex.slice(0, ta.selectionStart) + result.latex + latex.slice(ta.selectionEnd);
    setLatex(next, { checkpoint: true });
    setPasteNote(result.note);
  }, [latex, setLatex, setPasteNote]);

  // ── Convert-tab link ─────────────────────────────────────────────────────
  // Every expression from every result, flattened into one picker, each remembering
  // where it came from so an edit can be written back to the right slot.
  const expressions = useMemo(() => {
    const list: Array<{ resultId: string; exprIndex: number; fileName: string; tex: string; dataUrl?: string }> = [];
    for (const r of results ?? []) {
      r.expressions.forEach((tex, i) =>
        list.push({ resultId: r.id, exprIndex: i, fileName: r.fileName, tex, dataUrl: r.dataUrl }),
      );
    }
    return list;
  }, [results]);

  const linkedIdx = target
    ? expressions.findIndex((e) => e.resultId === target.resultId && e.exprIndex === target.exprIndex)
    : -1;
  const linked = linkedIdx >= 0 ? expressions[linkedIdx] : undefined;

  // Linking to a different expression loads a different document, so the history
  // starts fresh rather than letting undo walk back into the previous formula.
  const targetKey = linked ? `${linked.resultId}:${linked.exprIndex}` : "";
  const lastSyncRef = useRef("");
  if (targetKey && targetKey !== lastSyncRef.current) {
    doc.reset(linked!.tex);
    lastSyncRef.current = targetKey;
  }
  if (!targetKey && lastSyncRef.current) lastSyncRef.current = "";

  // An expression handed over from the LaTeX tab. It arrives unlinked — there is no
  // result id to write back to — so it loads as a scratch equation and the link is
  // dropped, which is also what stops the effect above from immediately overwriting it.
  useEffect(() => {
    if (!seed) return;
    setTarget(null);
    doc.reset(seed);
    setNote("Loaded from the LaTeX tab — copy the result back when you are done.");
    onSeedConsumed?.();
  }, [seed, doc, setTarget, onSeedConsumed]);

  const goTo = (i: number) => {
    const e = expressions[i];
    if (e) setTarget({ resultId: e.resultId, exprIndex: e.exprIndex });
  };

  const mathml = useMemo(() => (latex ? latexToMathml(latex, true) : ""), [latex]);

  const applyToConvert = useCallback(() => {
    if (!linked || !setResults) return;
    const mf = mfRef.current;
    const tex = mf ? readMathfield(mf) : latex;
    setResults((prev) =>
      prev.map((r) => {
        if (r.id !== linked.resultId) return r;
        const next = r.expressions.map((e, i) => (i === linked.exprIndex ? tex : e));
        return { ...r, expressions: next, mathml: next.map((e) => latexToMathml(e, true)) };
      }),
    );
    setNote(`Applied to ${linked.fileName} — expression ${linked.exprIndex + 1}.`);
  }, [latex, linked, mfRef, setResults]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(""), 4000);
    return () => clearTimeout(t);
  }, [note]);

  // Virtual keyboard is opt-in: it covers a third of the screen, which is right on a
  // tablet and wrong on the desktop this app is mostly used from.
  useEffect(() => {
    if (!ready) return;
    const vk = window.mathVirtualKeyboard;
    if (!vk) return;
    if (kbd) vk.show();
    else vk.hide();
    return () => vk.hide();
  }, [kbd, ready]);

  // ── Keyboard ─────────────────────────────────────────────────────────────
  // Capture phase on the window, so undo pre-empts both MathLive's internal stack and
  // the textarea's native one — either would disagree with this shared history.
  const { undo, redo } = doc;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const intent = undoRedoIntent(e);
      if (intent) {
        e.preventDefault();
        e.stopPropagation();
        if (intent === "undo") undo();
        else redo();
        return;
      }
      if (e.key === "Escape") {
        // Nothing to abandon here — this is a page, not a dialog — so Esc only
        // dismisses what is layered on top of it.
        if (openGroup || openMenu || matrixOpen) { setOpenGroup(null); setOpenMenu(null); setMatrixOpen(false); return; }
        if (kbd) setKbd(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [undo, redo, openGroup, openMenu, kbd, matrixOpen]);

  // Close any open popover when the pointer lands anywhere that is not one.
  useEffect(() => {
    if (!openGroup && !openMenu && !matrixOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-popover]")) {
        setOpenGroup(null);
        setOpenMenu(null);
        setMatrixOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [openGroup, openMenu, matrixOpen]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold text-white">MathType Editor</h2>
        <Badge tone="blue">visual editor</Badge>
        {latex !== "" && <span className="text-[11px] text-slate-500">{latex.length} chars</span>}
        {expressions.length > 0 && <Badge>{expressions.length} converted expr</Badge>}
      </div>

      {/* ── link to a converted expression ── */}
      <div className="space-y-2 rounded-2xl border border-white/8 bg-[var(--surface-card)] p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[240px] flex-1">
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Edit a converted expression (optional)
            </label>
            <Select
              value={targetKey}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) { setTarget(null); return; }
                const [resultId, idx] = v.split(":");
                setTarget({ resultId, exprIndex: parseInt(idx, 10) });
              }}
              className="w-full"
              disabled={expressions.length === 0}
            >
              <option value="">
                {expressions.length === 0 ? "No converted expressions yet — type below" : "Not linked — free-form equation"}
              </option>
              {expressions.map((e) => (
                <option key={`${e.resultId}:${e.exprIndex}`} value={`${e.resultId}:${e.exprIndex}`}>
                  {e.fileName} — Expr {e.exprIndex + 1}
                </option>
              ))}
            </Select>
          </div>
          {linked && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" variant="ghost" disabled={linkedIdx <= 0} onClick={() => goTo(linkedIdx - 1)} title="Previous expression">‹ Prev</Button>
              <span className="text-[11px] text-slate-500">{linkedIdx + 1} / {expressions.length}</span>
              <Button size="sm" variant="ghost" disabled={linkedIdx >= expressions.length - 1} onClick={() => goTo(linkedIdx + 1)} title="Next expression">Next ›</Button>
              <Button size="sm" variant="success" onClick={applyToConvert}>✓ Apply to Convert</Button>
              <Button size="sm" variant="ghost" onClick={() => setTarget(null)}>Unlink</Button>
            </div>
          )}
        </div>
        <p className="text-[11px] text-slate-500">
          {linked
            ? "Apply writes the edited LaTeX and its MathML back into the Convert result, so every export picks it up."
            : "Nothing is linked, so this is a scratch equation — copy or export it from the status bar below."}
        </p>
        {note && (
          <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-200">✓ {note}</div>
        )}
      </div>

      {/* Source image for the linked expression. Checking a transcription against the
          glyphs it came from is the whole reason this tab exists, so the image sits
          directly above the editor rather than back on the Convert tab. */}
      {linked?.dataUrl && (
        <div className="space-y-2 rounded-2xl border border-white/8 bg-[var(--surface-card)] p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200">Source Image</h3>
            <span className="truncate text-[10px] text-slate-500" title={linked.fileName}>{linked.fileName}</span>
          </div>
          <ImageZoom src={linked.dataUrl} alt={linked.fileName} heightClass="h-64 md:h-80" />
        </div>
      )}

      {/* ── the editor itself ── */}
      <div className="overflow-visible rounded-2xl border border-white/8 bg-[var(--surface-card)]">
        {/* menu bar */}
        <div className="flex flex-wrap items-center gap-0.5 rounded-t-2xl border-b border-white/8 bg-white/[0.02] px-2 py-1 text-xs" data-popover>
          <Menu name="File" open={openMenu} setOpen={setOpenMenu} items={[
            { label: "Apply to Convert", onClick: applyToConvert, disabled: !linked },
            { label: "Copy LaTeX", onClick: () => copyText(latex) },
            { label: "Copy MathML", onClick: () => copyText(mathml) },
            { sep: true },
            { label: "Save as .tex", onClick: () => download("equation.tex", latex, "text/x-tex") },
            { label: "Save as .mml", onClick: () => download("equation.mml", mathml, "application/mathml+xml") },
          ]} />
          <Menu name="Edit" open={openMenu} setOpen={setOpenMenu} items={[
            { label: "Undo", hint: "Ctrl+Z", onClick: undo, disabled: !doc.canUndo },
            { label: "Redo", hint: "Ctrl+Y", onClick: redo, disabled: !doc.canRedo },
            { sep: true },
            { label: "Cut", onClick: () => cmd("cutToClipboard") },
            { label: "Copy", onClick: () => cmd("copyToClipboard") },
            { label: "Paste maths", hint: "Ctrl+V", onClick: paste },
            { sep: true },
            { label: "Select all", hint: "Ctrl+A", onClick: () => cmd("selectAll") },
            { label: "Delete selection", onClick: () => cmd("deleteBackward") },
            { sep: true },
            { label: "Revert to linked original", onClick: () => setLatex(linked!.tex, { checkpoint: true }), disabled: !linked },
            { label: "Clear", onClick: () => setLatex("", { checkpoint: true }) },
          ]} />
          <Menu name="View" open={openMenu} setOpen={setOpenMenu} items={[
            { label: "Visual + LaTeX", check: panel === "split", onClick: () => setPanel("split") },
            { label: "Visual only", check: panel === "visual", onClick: () => setPanel("visual") },
            { label: "LaTeX only", check: panel === "latex", onClick: () => setPanel("latex") },
            { sep: true },
            { label: "Show MathML source", check: showMathml, onClick: () => setShowMathml((v) => !v) },
            { label: "Virtual keyboard", check: kbd, onClick: () => setKbd((v) => !v) },
          ]} />
          <Menu name="Format" open={openMenu} setOpen={setOpenMenu} items={[
            { label: "Bold", hint: "Ctrl+B", onClick: () => insert("\\mathbf{#?}") },
            { label: "Italic", hint: "Ctrl+I", onClick: () => insert("\\mathit{#?}") },
            { label: "Upright (roman)", onClick: () => insert("\\mathrm{#?}") },
            { label: "Blackboard bold", onClick: () => insert("\\mathbb{#?}") },
            { label: "Calligraphic", onClick: () => insert("\\mathcal{#?}") },
            { label: "Fraktur", onClick: () => insert("\\mathfrak{#?}") },
            { sep: true },
            { label: "Text mode", hint: "Ctrl+Shift+E", onClick: () => insert("\\text{#?}") },
            { label: "Boxed", onClick: () => insert("\\boxed{#?}") },
          ]} />
          {/* Every shortcut, listed from the same table the key handler reads, so the
              menu cannot drift out of step with what the keys actually do. */}
          <Menu name="Insert" open={openMenu} setOpen={setOpenMenu} items={[
            { label: "Matrix…", onClick: () => setMatrixOpen(true) },
            { sep: true },
            ...SHORTCUTS.map((s) => ({
              label: s.name,
              hint: shortcutLabel(s),
              onClick: () => insert(s.tex),
            })),
          ]} />
          <Menu name="Size" open={openMenu} setOpen={setOpenMenu} items={[100, 125, 150, 200, 300].map((z) => ({
            label: `${z}%`,
            check: zoom === z,
            onClick: () => setZoom(z),
          }))} />

          <div className="ml-auto flex items-center gap-1">
            <IconBtn title="Undo (Ctrl+Z)" onClick={undo} disabled={!doc.canUndo}>↶</IconBtn>
            <IconBtn title="Redo (Ctrl+Y or Ctrl+Shift+Z)" onClick={redo} disabled={!doc.canRedo}>↷</IconBtn>
            <IconBtn title="Toggle virtual keyboard" active={kbd} onClick={() => setKbd((v) => !v)}>⌨</IconBtn>
          </div>
        </div>

        {/* palette ribbons */}
        <div className="border-b border-white/8 bg-[var(--surface-bar)] px-2 py-1.5" data-popover>
          <Ribbon groups={SYMBOL_GROUPS} openGroup={openGroup} setOpenGroup={setOpenGroup} onPick={insert} />
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Ribbon groups={TEMPLATE_GROUPS} openGroup={openGroup} setOpenGroup={setOpenGroup} onPick={insert} />
            {/* Sized separately from the template palettes: any row/column count is one
                gesture here, where a palette can only list the shapes it was built with. */}
            <button
              ref={setMatrixBtn}
              title="Insert matrix — choose size and brackets"
              onClick={() => { setOpenGroup(null); setMatrixOpen((v) => !v); }}
              className={cn(
                "flex h-8 items-center gap-1 rounded-lg border px-2 text-sm transition-colors",
                matrixOpen
                  ? "border-violet-400/50 bg-violet-500/20 text-white"
                  : "border-white/8 bg-white/[0.03] text-slate-300 hover:border-white/15 hover:bg-white/8 hover:text-white",
              )}
            >
              <span className="leading-none">▦</span>
              <span className="text-[10px] leading-none">n×m</span>
            </button>
            <MatrixBuilder
              open={matrixOpen}
              anchor={matrixBtn}
              onInsert={insert}
              onClose={() => setMatrixOpen(false)}
            />
          </div>
        </div>

        {/* editing surface */}
        <div className="p-4">
          {loadError && (
            <div className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              The visual editor could not load ({loadError}). The LaTeX pane still works.
            </div>
          )}

          {pasteNote && (
            <div className="mb-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200">
              ⇄ {pasteNote}
            </div>
          )}

          <div className={cn("grid gap-3", panel === "split" && "xl:grid-cols-2")}>
            {panel !== "latex" && (
              <div className="min-w-0">
                <Label>Visual — Enter = new line · Tab = next slot · Ctrl+/ fraction · Ctrl+↑ ↓ scripts · select first to wrap it</Label>
                {/* `resize-y` on the wrapper rather than the mathfield: a custom element
                    with its own shadow DOM does not honour CSS resize, so the handle
                    goes on a plain div and the field fills it. */}
                <div className="relative min-h-[220px] resize-y overflow-auto rounded-xl" style={{ fontSize: `${zoom}%` }}>
                  <div ref={hostRef} />
                  {!ready && !loadError && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-[var(--surface-sunken)] text-xs text-slate-500">
                      <Spinner className="h-4 w-4" /> Loading editor…
                    </div>
                  )}
                </div>
              </div>
            )}

            {panel !== "visual" && (
              <div className="min-w-0">
                <Label>LaTeX — edits here appear in the visual pane immediately</Label>
                <textarea
                  value={latex}
                  onChange={(e) => setLatex(e.target.value)}
                  onPaste={onPasteLatex}
                  spellCheck={false}
                  rows={panel === "latex" ? 12 : 8}
                  className="w-full resize-y rounded-xl border border-white/10 bg-[var(--surface-sunken)] px-3 py-2.5 font-mono text-xs leading-relaxed text-sky-200 focus:border-violet-400/50 focus:outline-none"
                  placeholder="\frac{-b \pm \sqrt{b^2-4ac}}{2a}   ·   paste MathML and it converts"
                />
                <Label className="mt-3">Rendered preview (KaTeX)</Label>
                <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-lg">
                  <MathView tex={latex} display />
                </div>
                {showMathml && (
                  <pre className="mt-3 max-h-44 overflow-auto rounded-xl border border-white/10 bg-[var(--surface-sunken)] p-2.5 text-[11px] leading-relaxed text-emerald-300/80">{mathml}</pre>
                )}
              </div>
            )}
          </div>

          {/* tabbed template bar */}
          <div className="mt-4 rounded-xl border border-white/10 bg-[var(--surface-bar)]">
            <div className="flex flex-wrap gap-0.5 border-b border-white/8 px-1.5 pt-1.5">
              {TEMPLATE_TABS.map((t) => (
                <button
                  key={t.name}
                  onClick={() => setTab(t.name)}
                  className={cn(
                    "rounded-t-lg px-3 py-1.5 text-[11px] font-medium transition-colors",
                    tab === t.name ? "bg-white/8 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
                  )}
                >
                  {t.name}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5 p-2">
              {(TEMPLATE_TABS.find((t) => t.name === tab) || TEMPLATE_TABS[0]).items.map((it, i) => (
                <PaletteButton key={i} item={it} onPick={insert} wide />
              ))}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-slate-500">Start from:</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                onClick={() => setLatex(ex.tex, { checkpoint: true })}
                className="rounded border border-white/10 bg-[var(--surface-well)] px-2 py-0.5 text-[10px] text-slate-300 hover:border-violet-400/40 hover:text-white"
              >
                {ex.label}
              </button>
            ))}
          </div>
        </div>

        {/* status bar */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-b-2xl border-t border-white/10 bg-white/[0.02] px-4 py-2.5 text-[11px] text-slate-500">
          <span>Style: <span className="text-slate-300">{status}</span></span>
          <span>Zoom: <span className="text-slate-300">{zoom}%</span></span>
          <span>{latex.length} chars</span>
          <span className={doc.canUndo || doc.canRedo ? "" : "opacity-50"}>
            ↶ {doc.canUndo ? "undo" : "—"} · ↷ {doc.canRedo ? "redo" : "—"}
          </span>
          {linked && <Badge tone="blue">linked to {linked.fileName}</Badge>}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => copyText(latex)}>⎘ LaTeX</Button>
            <Button size="sm" variant="ghost" onClick={() => copyText(mathml)}>⎘ MathML</Button>
            <Button size="sm" variant="ghost" onClick={() => download("equation.tex", latex, "text/x-tex")}>⤓ .tex</Button>
            <Button size="sm" variant="ghost" onClick={() => download("equation.mml", mathml, "application/mathml+xml")}>⤓ .mml</Button>
            {linked && <Button size="sm" variant="primary" onClick={applyToConvert}>✓ Apply to Convert</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}
