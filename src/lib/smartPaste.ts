import { looksLikeMathml, mathmlToLatex } from "./mathmlToLatex";

/**
 * Turn whatever is on the clipboard into LaTeX.
 *
 * Maths arrives from a lot of places and almost none of them put plain LaTeX on the
 * clipboard. Copying a formula out of a web page gives rendered HTML; out of Word or
 * desktop MathType, MathML; out of a paper's PDF, LaTeX wrapped in `$…$`. Each of those
 * is recoverable, so the paste path tries them in order of fidelity rather than dumping
 * the raw markup into the editor and leaving the user to clean it up.
 *
 * Order matters: a TeX annotation is the author's own source, so it beats reconstructing
 * LaTeX from the MathML tree, which is a lossy translation of that same source.
 */

export type PasteKind = "annotation" | "mathml" | "latex" | "plain";

export type PasteResult = {
  latex: string;
  kind: PasteKind;
  /** Short, user-facing account of what happened, for the editor's paste note. */
  note: string;
};

/**
 * `<annotation encoding="application/x-tex">` — where KaTeX, MathJax and Wikipedia all
 * keep the original TeX alongside the MathML they render. Reading it back is exact.
 */
function texAnnotations(markup: string): string {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(markup, "text/html");
  } catch {
    return "";
  }
  const found: string[] = [];
  for (const el of Array.from(doc.querySelectorAll("annotation, *|annotation"))) {
    const enc = el.getAttribute("encoding") || "";
    if (!/x-tex|tex/i.test(enc)) continue;
    const tex = (el.textContent || "").trim();
    if (tex) found.push(tex);
  }
  // KaTeX puts a full copy of the formula in a visually-hidden .katex-mathml span *and*
  // renders it again as styled HTML, so the same annotation can legitimately appear
  // twice for one formula. Dedupe adjacent repeats rather than pasting it twice.
  return found.filter((t, i) => t !== found[i - 1]).join("\n");
}

/** Strip the delimiters LaTeX is usually quoted with, so `$x^2$` pastes as `x^2`. */
export function stripMathDelimiters(s: string): string {
  let t = s.trim();
  // Repeat: display maths copied from a paper often arrives as `$$\[ … \]$$`.
  for (let i = 0; i < 3; i++) {
    const before = t;
    t = t
      .replace(/^\$\$([\s\S]*)\$\$$/, "$1")
      .replace(/^\$([\s\S]*)\$$/, "$1")
      .replace(/^\\\[([\s\S]*)\\\]$/, "$1")
      .replace(/^\\\(([\s\S]*)\\\)$/, "$1")
      .trim();
    if (t === before) break;
  }
  return t;
}

/** Does this look like LaTeX rather than prose? */
export function looksLikeLatex(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  return (
    /\\[a-zA-Z]{2,}/.test(t) ||       // a command: \frac, \alpha, \begin
    /[_^]\{?[^\s]/.test(t) ||          // a sub- or superscript
    /^\$\$?[\s\S]+\$\$?$/.test(t) ||   // dollar-delimited
    /^\\[[(][\s\S]+\\[\])]$/.test(t)   // \[ … \] or \( … \)
  );
}

/**
 * Best-effort conversion of a clipboard payload to LaTeX. Returns null when nothing
 * usable was found, which is the caller's signal to let the default paste happen.
 */
export function clipboardToLatex(html: string, plain: string): PasteResult | null {
  const h = (html || "").trim();
  const p = (plain || "").trim();

  // 1. The author's own TeX, carried alongside the rendering.
  if (h) {
    const tex = texAnnotations(h);
    if (tex) {
      return {
        latex: tex,
        kind: "annotation",
        note: "Pasted rendered maths — recovered its original LaTeX source.",
      };
    }
  }

  // 2. MathML, from Word, desktop MathType, or a "copy as MathML" menu.
  const mathmlSrc = looksLikeMathml(h) ? h : looksLikeMathml(p) ? p : h.includes("<math") ? h : "";
  if (mathmlSrc) {
    const tex = mathmlToLatex(mathmlSrc);
    if (tex.trim()) {
      return {
        latex: tex,
        kind: "mathml",
        note: `MathML converted to LaTeX (${tex.split("\n").length} expr).`,
      };
    }
  }

  // 3. Plain LaTeX, usually still wearing its delimiters.
  if (p && looksLikeLatex(p)) {
    const tex = stripMathDelimiters(p);
    if (tex) {
      const stripped = tex !== p;
      return {
        latex: tex,
        kind: "latex",
        note: stripped ? "Pasted LaTeX — delimiters removed." : "Pasted LaTeX.",
      };
    }
  }

  // 4. Unicode maths with no markup at all (`α² + β² = γ²`) is left to the caller:
  // MathLive's own paste handles single symbols better than a guess would.
  return null;
}
