import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction, type KeyboardEvent, type ClipboardEvent } from "react";
import type { ConvertResult } from "@/types";
import { MathView } from "./MathView";
import { ImageZoom } from "./ImageZoom";
import { Badge, Button, Select } from "./ui";
import { latexToMathml } from "@/lib/mathRender";
import { latexToMathmlEnhanced } from "@/lib/mathmlEngine";
import { looksLikeMathml, mathmlToLatex } from "@/lib/mathmlToLatex";
import { clipboardToLatex } from "@/lib/smartPaste";
import { copyText, download, slugify } from "@/lib/utils";
import { MATH_PALETTES, LATEX_SHORTCUTS } from "@/lib/mathPalettes";
import { useUndoable, undoRedoIntent } from "@/hooks/useUndoable";

type LatexTarget = { resultId: string; exprIndex: number } | null;

const EXAMPLES: { label: string; tex: string }[] = [
  { label: "Quadratic", tex: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}" },
  { label: "Matrix", tex: "\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}" },
  { label: "Integral", tex: "\\int_{0}^{\\infty} e^{-x^{2}}\\,dx = \\frac{\\sqrt{\\pi}}{2}" },
  { label: "Sum", tex: "\\sum_{n=1}^{\\infty} \\frac{1}{n^{2}} = \\frac{\\pi^{2}}{6}" },
  { label: "Limit", tex: "\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1" },
  { label: "Piecewise", tex: "f(x) = \\begin{cases} x^{2} & x \\geq 0 \\\\ -x & x < 0 \\end{cases}" },
  { label: "Chain", tex: "\\begin{aligned} (a+b)^2 &= a^2+2ab+b^2 \\\\ &< (a+b+1)^2 \\end{aligned}" },
  { label: "Tensor", tex: "R_{\\mu\\nu} - \\tfrac{1}{2}R g_{\\mu\\nu} = \\frac{8\\pi G}{c^{4}} T_{\\mu\\nu}" },
  { label: "Euler", tex: "e^{i\\pi} + 1 = 0" },
  { label: "Maxwell", tex: "\\nabla \\times \\vec{B} = \\mu_0 \\vec{J} + \\mu_0 \\epsilon_0 \\frac{\\partial \\vec{E}}{\\partial t}" },
  { label: "Schrödinger", tex: "i\\hbar \\frac{\\partial}{\\partial t}\\Psi = \\hat{H}\\Psi" },
  { label: "Bayes", tex: "P(A|B) = \\frac{P(B|A) \\, P(A)}{P(B)}" },
];

// Quick snippets row (most used)
const SNIPPETS: { label: string; insert: string }[] = [
  { label: "frac", insert: "\\frac{}{}" },
  { label: "√", insert: "\\sqrt{}" },
  { label: "x^n", insert: "^{}" },
  { label: "x_n", insert: "_{}" },
  { label: "∑", insert: "\\sum_{n=1}^{\\infty}" },
  { label: "∏", insert: "\\prod_{n=1}^{\\infty}" },
  { label: "∫", insert: "\\int_{}^{}" },
  { label: "lim", insert: "\\lim_{x \\to 0}" },
  { label: "bmatrix", insert: "\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}" },
  { label: "cases", insert: "\\begin{cases} x & \\text{if} \\\\ y & \\text{else} \\end{cases}" },
  { label: "aligned", insert: "\\begin{aligned} a &= b \\\\ &= c \\end{aligned}" },
  { label: "binom", insert: "\\binom{}{}" },
];

const DELIMS = [
  { id: "none", label: "Raw LaTeX" },
  { id: "inline", label: "$ … $" },
  { id: "display", label: "$$ … $$" },
  { id: "paren", label: "\\( … \\)" },
];

function wrap(expr: string, delim: string): string {
  switch (delim) {
    case "inline": return "$" + expr + "$";
    case "display": return "$$" + expr + "$$";
    case "paren": return "\\(" + expr + "\\)";
    default: return expr;
  }
}

export function LatexTab({
  results,
  setResults,
  target,
  setTarget,
  onOpenInMathType,
}: {
  results?: ConvertResult[];
  setResults?: Dispatch<SetStateAction<ConvertResult[]>>;
  target?: LatexTarget;
  setTarget?: (t: LatexTarget) => void;
  /** Sends one expression to the MathType tab to be edited visually. */
  onOpenInMathType?: (latex: string) => void;
}) {
  /**
   * The document, with history. A plain `useState` would leave Ctrl+Z at the mercy of
   * the browser's native textarea stack, which is discarded whenever the value is set
   * programmatically — and in this editor most edits are: every palette glyph, every
   * snippet, MathML→LaTeX conversion, loading an example, applying a MathType edit.
   * Native undo would silently skip all of them.
   */
  const doc = useUndoable(EXAMPLES[0].tex);
  const text = doc.value;
  const setText = doc.set;
  const [delim, setDelim] = useState("none");
  const [showSrc, setShowSrc] = useState(false);
  const [palette, setPalette] = useState("Greek");
  const [view, setView] = useState<"split" | "preview">("split");
  const taRef = useRef<HTMLTextAreaElement>(null);

  // ── Convert-tab integration ──────────────────────────────────────────────
  // When a target is set, load that expression into the editor.
  const connectedResult = target ? results?.find((r) => r.id === target.resultId) : undefined;
  const connectedExpr = connectedResult && target ? connectedResult.expressions[target.exprIndex] : undefined;

  // Sync editor with the connected expression (only when target changes)
  const targetKey = target ? `${target.resultId}:${target.exprIndex}` : "";
  const lastSyncRef = useRef("");
  if (targetKey && targetKey !== lastSyncRef.current && connectedExpr !== undefined) {
    // Linking to a different expression loads a different document, so the history
    // starts fresh — undo must not walk back into the previously linked formula.
    doc.reset(connectedExpr);
    lastSyncRef.current = targetKey;
  }
  if (!targetKey && lastSyncRef.current !== "") {
    lastSyncRef.current = "";
  }

  // ── Undo/redo ────────────────────────────────────────────────────────────
  // Bound on the window in the capture phase so the gesture works from anywhere in
  // the tab — the textarea, a palette button, the toolbar — and so it pre-empts the
  // textarea's own native undo, which would otherwise disagree with this history.
  const { undo, redo } = doc;
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const intent = undoRedoIntent(e);
      if (!intent) return;
      e.preventDefault();
      e.stopPropagation();
      if (intent === "undo") undo();
      else redo();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [undo, redo]);

  const insertAtCursor = (snippet: string) => {
    const ta = taRef.current;
    if (!ta) {
      setText((t) => t + snippet, { checkpoint: true });
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = text.slice(0, start);
    const after = text.slice(end);
    // place cursor inside first {} if present
    const brace = snippet.indexOf("{}");
    const caret = brace >= 0 ? start + brace + 1 : start + snippet.length;
    const next = before + snippet + after;
    // Each insertion is a discrete action, so it gets its own history entry rather
    // than merging into an adjacent burst of typing.
    setText(next, { checkpoint: true });
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(caret, caret);
    });
  };

  const [pasteNote, setPasteNote] = useState("");
  useEffect(() => {
    if (!pasteNote) return;
    const t = setTimeout(() => setPasteNote(""), 4000);
    return () => clearTimeout(t);
  }, [pasteNote]);

  /**
   * Paste maths, get LaTeX. The clipboard is where non-LaTeX maths actually arrives
   * from — Word and desktop MathType send MathML, a web page sends its rendering with
   * the original TeX tucked inside it, a paper sends LaTeX still wearing its `$…$` —
   * so intercepting the paste is the only place the conversion is invisible to the
   * user. Anything unrecognised falls through to the browser's own paste untouched.
   */
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const html = e.clipboardData.getData("text/html");
    const plain = e.clipboardData.getData("text/plain");

    const result = clipboardToLatex(html, plain);
    if (!result?.latex.trim()) {
      // Only warn when it *looked* like MathML and still would not parse; ordinary
      // text pasting normally is not worth a message.
      if (looksLikeMathml(html) || looksLikeMathml(plain)) {
        setPasteNote("Pasted MathML could not be parsed — inserted as-is.");
      }
      return;
    }
    e.preventDefault();
    insertAtCursor(result.latex);
    setPasteNote(result.note);
  };

  // Expressions, each remembering which source line it came from. The line number is
  // what makes visual editing possible: MathType hands back one edited formula, and
  // it has to go back into the exact line it came out of, not append at the end.
  const exprLines = useMemo(
    () => text.split("\n").map((l, i) => ({ tex: l.trim(), line: i })).filter((x) => x.tex),
    [text],
  );
  const exprs = useMemo(() => exprLines.map((x) => x.tex), [exprLines]);
  const allLatex = useMemo(() => exprs.map((e) => wrap(e, delim)).join("\n"), [exprs, delim]);
  const allMathml = useMemo(() => exprs.map((e) => latexToMathml(e, true)).join("\n\n"), [exprs]);

  // Hand one expression to the MathType tab for visual editing. This used to open a
  // dialog over this tab and splice the result back into its source line; the editor is
  // now a page of its own, so the expression travels there as a scratch equation and
  // comes back by copy. A page cannot write into the tab that opened it without
  // outliving it, and a linked round trip belongs to converted results, which have an
  // id to write back to — a line of free-form text does not.
  const openInMathType = (tex: string) => onOpenInMathType?.(tex);

  // v6: Enhanced MathML using multi-engine conversion (async)
  const [enhancedMathml, setEnhancedMathml] = useState("");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const results = await Promise.all(exprs.map((e) => latexToMathmlEnhanced(e, true)));
      if (!cancelled) setEnhancedMathml(results.filter(Boolean).join("\n\n"));
    })();
    return () => { cancelled = true; };
  }, [exprs]);

  // v6: Keyboard shortcuts for the LaTeX editor
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    const shift = e.shiftKey;
    // Find matching shortcut
    const sc = LATEX_SHORTCUTS.find((s) => {
      const parts = s.key.toLowerCase().split("+");
      const sKey = parts[parts.length - 1];
      const sShift = s.key.includes("Shift");
      return sShift === shift && sKey === key;
    });
    if (sc && sc.insert) {
      e.preventDefault();
      insertAtCursor(sc.insert);
    }
  };

  const applyToConvert = () => {
    if (!target || !setResults || !connectedResult) return;
    const expressions = connectedResult.expressions.slice();
    expressions[target.exprIndex] = exprs.join("\n") || text.trim();
    setResults((prev) =>
      prev.map((r) =>
        r.id === target.resultId
          ? { ...r, expressions, mathml: expressions.map((e) => latexToMathml(e, true)) }
          : r,
      ),
    );
  };
  const disconnect = () => {
    setTarget?.(null);
    lastSyncRef.current = "";
  };

  const charCount = text.length;
  const lineCount = text.split("\n").length;

  return (
    <div className="space-y-3">
      {/* connection banner */}
      {connectedResult && target && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-400/30 bg-violet-500/10 px-3 py-2.5 text-xs">
          <Badge tone="blue">Linked</Badge>
          <span className="text-violet-200">
            Editing Expression {target.exprIndex + 1} of <b>{connectedResult.fileName}</b>
          </span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="success" onClick={applyToConvert}>✓ Apply to Convert</Button>
            <Button size="sm" variant="ghost" onClick={disconnect}>Unlink</Button>
          </div>
        </div>
      )}

      {/* Source image for the linked expression. Editing LaTeX against the
          original glyphs is the whole point of the link, so the image sits
          right above the editor rather than back on the Convert tab. */}
      {connectedResult?.dataUrl && (
        <div className="space-y-2 rounded-2xl border border-white/8 bg-[var(--surface-card)] p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200">Source Image</h3>
            <span className="truncate text-[10px] text-slate-500" title={connectedResult.fileName}>{connectedResult.fileName}</span>
          </div>
          <ImageZoom src={connectedResult.dataUrl} alt={connectedResult.fileName} heightClass="h-64 md:h-80" />
        </div>
      )}

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/8 bg-[var(--surface-card)] p-2.5">
        <div className="flex items-center gap-1 rounded-lg bg-black/30 p-0.5">
          {(["split", "preview"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={"rounded-md px-3 py-1 text-xs font-medium capitalize " + (view === v ? "bg-violet-500 text-on-accent" : "text-slate-400 hover:text-white")}>
              {v}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <div className="flex items-center gap-0.5 rounded-lg bg-black/30 p-0.5">
            <button
              onClick={undo}
              disabled={!doc.canUndo}
              title="Undo (Ctrl+Z)"
              className="h-7 w-7 rounded-md text-sm text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:pointer-events-none"
            >↶</button>
            <button
              onClick={redo}
              disabled={!doc.canRedo}
              title="Redo (Ctrl+Y or Ctrl+Shift+Z)"
              className="h-7 w-7 rounded-md text-sm text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:pointer-events-none"
            >↷</button>
          </div>
          {/* Visual editing of the first expression. Per-expression buttons live in
              the preview column; this one is here so the feature is visible without
              having to scroll to find it. */}
          <Button size="sm" variant="outline" disabled={!exprs.length || !onOpenInMathType} title="Edit the first expression visually on the MathType tab" onClick={() => openInMathType(exprs[0] ?? "")}>∑ MathType</Button>
          <Button size="sm" variant="outline" onClick={() => copyText(allLatex)}>⎘ Copy LaTeX</Button>
          <Button size="sm" variant="outline" onClick={() => copyText(enhancedMathml || allMathml)}>⎘ Copy MathML</Button>
          <Button size="sm" variant="ghost" onClick={() => download(slugify("mathorium") + ".mml", '<?xml version="1.0"?>\n<mathset>\n' + (enhancedMathml || allMathml) + "\n</mathset>", "application/mathml+xml")}>⤓ .mml</Button>
          <Button size="sm" variant="ghost" onClick={() => download(slugify("mathorium") + ".tex", "\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n" + allLatex + "\n\\end{document}")}>⤓ .tex</Button>
          <Button size="sm" variant="ghost" onClick={() => setText("", { checkpoint: true })}>Clear</Button>
        </div>
      </div>

      <div className={view === "split" ? "grid gap-4 lg:grid-cols-2" : "grid gap-4"}>
        {/* editor */}
        <div className="space-y-2 rounded-2xl border border-white/8 bg-[var(--surface-card)] p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200">LaTeX Editor</h3>
            <span className="text-[10px] text-slate-500">{lineCount} lines · {charCount} chars · each line = one expression</span>
          </div>

          {/* snippet row */}
          <div className="flex flex-wrap gap-1">
            {SNIPPETS.map((s) => (
              <button key={s.label} onClick={() => insertAtCursor(s.insert)} title={s.insert}
                className="rounded-md border border-white/10 bg-[var(--surface-well)] px-2 py-1 font-mono text-[11px] text-sky-200 hover:border-violet-400/40 hover:bg-violet-500/10">
                {s.label}
              </button>
            ))}
          </div>

          {/* v5: Comprehensive categorized symbol palette */}
          <div className="rounded-xl border border-white/8 bg-[var(--surface-well)] p-2">
            <div className="mb-1.5 flex flex-wrap gap-1">
              {MATH_PALETTES.map((p) => (
                <button key={p.name} onClick={() => setPalette(p.name)}
                  className={"flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium " + (palette === p.name ? "bg-violet-500 text-on-accent" : "text-slate-400 hover:text-white")}>
                  <span className="text-sm">{p.icon}</span>
                  {p.name}
                </button>
              ))}
            </div>
            <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
              {MATH_PALETTES.find((p) => p.name === palette)?.items.map((it, i) => (
                <button key={i} onClick={() => insertAtCursor(it.tex)} title={it.tex + (it.name ? " — " + it.name : "")}
                  className="flex h-7 min-w-7 items-center justify-center rounded border border-white/8 bg-white/5 px-1.5 text-sm text-slate-200 hover:border-violet-400/40 hover:bg-violet-500/15">
                  {it.sym}
                </button>
              ))}
            </div>
          </div>

          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            spellCheck={false}
            rows={view === "split" ? 11 : 18}
            className="w-full resize-y rounded-xl border border-white/10 bg-[var(--surface-well)] p-3 font-mono text-sm leading-relaxed text-sky-200 focus:border-violet-400/50 focus:outline-none"
            placeholder="Type or paste LaTeX here…  (paste MathML and it auto-converts · one expression per line)"
          />

          {pasteNote && (
            <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-200">
              ⇄ {pasteNote}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-slate-500">Examples:</span>
            {EXAMPLES.map((ex) => (
              <button key={ex.label} onClick={() => { setText(ex.tex, { checkpoint: true }); taRef.current?.focus(); }}
                className="rounded border border-white/10 bg-[var(--surface-well)] px-2 py-0.5 text-[10px] text-slate-300 hover:border-violet-400/40 hover:text-white">
                {ex.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 border-t border-white/8 pt-2">
            <Select value={delim} onChange={(e) => setDelim(e.target.value)} className="h-8 w-auto py-0 text-xs">
              {DELIMS.map((d) => (<option key={d.id} value={d.id}>{d.label}</option>))}
            </Select>
            <Button size="sm" variant="ghost" onClick={() => setShowSrc((v) => !v)}>{showSrc ? "Hide" : "Show"} MathML</Button>
            <Button
              size="sm"
              variant="ghost"
              title="Convert MathML currently in the editor into LaTeX"
              disabled={!looksLikeMathml(text)}
              onClick={() => {
                const tex = mathmlToLatex(text);
                if (tex.trim()) {
                  setText(tex, { checkpoint: true });
                  setPasteNote(`MathML converted to LaTeX (${tex.split("\n").length} expr).`);
                } else {
                  setPasteNote("Could not parse that as MathML.");
                }
              }}
            >
              ⇄ MathML → LaTeX
            </Button>
          </div>
        </div>

        {/* preview */}
        <div className="space-y-2 rounded-2xl border border-white/8 bg-[var(--surface-card)] p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200">Rendered Preview</h3>
            <Badge>{exprs.length} expr</Badge>
          </div>
          <div className="space-y-3">
            {exprs.length === 0 && (
              <div className="rounded-xl border border-dashed border-white/10 px-3 py-12 text-center text-sm text-slate-500">Nothing to render yet.</div>
            )}
            {exprs.map((e, i) => (
              <div key={i} className="rounded-xl border border-white/10 bg-[var(--surface-well)] p-3">
                <div className="mb-1 flex items-center justify-between">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Expr {i + 1}</div>
                  {onOpenInMathType && (
                    <Button size="sm" variant="ghost" title="Edit this expression visually on the MathType tab" onClick={() => openInMathType(e)}>∑ MathType</Button>
                  )}
                </div>
                <div className="overflow-x-auto px-1 py-2 text-lg">
                  <MathView tex={e} display />
                </div>
                {showSrc && (
                  <pre className="mt-2 max-h-44 overflow-auto rounded-lg border border-white/10 bg-[var(--surface-sunken)] p-2.5 text-[11px] leading-relaxed text-emerald-300/80">{latexToMathml(e, true)}</pre>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}
