import katex from "katex";

/**
 * Sanitize LaTeX produced by AI models to maximize compatibility with KaTeX.
 * Many LLMs emit commands that KaTeX's strict parser dislikes; we normalize them.
 */
export function sanitizeLatex(tex: string): string {
  let t = tex;
  // 1) Strip surrounding delimiters if any slipped through: $...$ $$...$$ \(...\) \[...\]
  t = t
    .replace(/^\s*\$\$+/, "")
    .replace(/\$\$+\s*$/, "")
    .replace(/^\s*\$/, "")
    .replace(/\$\s*$/, "")
    .replace(/^\s*\\\(/, "")
    .replace(/\\\)\s*$/, "")
    .replace(/^\s*\\\[/, "")
    .replace(/\\\]\s*$/, "");

  // 2) Normalise common aliases / unsupported-but-equivalent commands.
  const replacements: [RegExp, string][] = [
    // \boldsymbol -> \mathbf  (KaTeX supports \boldsymbol via boldsymbol extension; map to be safe)
    [/\\boldsymbol\{/g, "\\mathbf{"],
    [/\\boldsymbol\s+([A-Za-z0-9])/g, "\\mathbf{$1}"],
    // \R \N \Z \C \Q \H shorthands -> \mathbb{}
    [/\\R\b/g, "\\mathbb{R}"],
    [/\\N\b/g, "\\mathbb{N}"],
    [/\\Z\b/g, "\\mathbb{Z}"],
    [/\\C\b/g, "\\mathbb{C}"],
    [/\\Q\b/g, "\\mathbb{Q}"],
    [/\\H\b/g, "\\mathbb{H}"],
    // \eps -> \epsilon
    [/\\eps\b/g, "\\epsilon"],
    // \var -> nothing dangerous; leave. \Rho etc already fine.
    // \align / \align* outside env -> gathered
    [/\\begin\{align\*?\}/g, "\\begin{aligned}"],
    [/\\end\{align\*?\}/g, "\\end{aligned}"],
    // \space -> \;
    [/\\space\b/g, "\\;"],
    // \middle| needs \middle support (KaTeX ok) — leave.
    // \bm -> \mathbf
    [/\\bm\{/g, "\\mathbf{"],
    // \textup, \textrm fine.
    // \thinspace \negthinspace fine.
    // remove trailing \\
    [/\\\\\s*$/g, ""],
    // \mbox -> \text
    [/\\mbox\b/g, "\\text"],
    // \displaystyle wraps are fine.
    // \arg\max -> \arg\max (KaTeX supports via defs) — leave.
    // \| ... \|  (norm) — KaTeX handles \|  as ‖ ok.
    // \AA \aa fine.
    // \diameter etc rare.
    // fix double-escaped: \\\\ -> \\  inside already handled upstream
  ];
  for (const [re, rep] of replacements) t = t.replace(re, rep);

  // 3) Collapse stray internal newlines (KaTeX hates raw newlines outside envs).
  // Protect \\ row breaks.
  t = t.replace(/\\\\/g, "\u0001RB\u0001");
  t = t.replace(/[\r\n]+/g, " ");
  t = t.replace(/\u0001RB\u0001/g, "\\\\");

  return t.trim();
}

/**
 * Render LaTeX to HTML via KaTeX — NEVER throws, never shows parse errors.
 * On total failure, returns an empty string so the caller can show raw LaTeX.
 */
export function renderLatex(tex: string, displayMode: boolean): string {
  if (!tex || !tex.trim()) return "";
  try {
    const out = katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: true,
      output: "html",
      macros: {
        "\\R": "\\mathbb{R}",
        "\\N": "\\mathbb{N}",
        "\\Z": "\\mathbb{Z}",
        "\\C": "\\mathbb{C}",
        "\\Q": "\\mathbb{Q}",
        // A plain-TeX line-break primitive KaTeX does not implement. MathLive emits it
        // for any multi-row value, so map it onto the environment that means the same
        // thing rather than rendering red error text.
        "\\displaylines": "\\begin{gathered}#1\\end{gathered}",
        // An unfilled hole in a MathLive template. It is part of every partially typed
        // formula, so the preview has to show it as the empty slot it is — as a red
        // "\placeholder" it read as a broken palette entry.
        "\\placeholder": "\\square",
      },
    });
    return out;
  } catch {
    // retry sanitized
    try {
      return katex.renderToString(sanitizeLatex(tex), {
        displayMode,
        throwOnError: false,
        strict: false,
        trust: true,
        output: "html",
      });
    } catch {
      return "";
    }
  }
}

/**
 * Pre-check whether a string is "math-like" to avoid trying to render plain
 * prose / currency as math.
 */
export function looksLikeMath(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  // currency like "$5", "$ 5", "$1,000"
  if (/^\$\s?\d/.test(t)) return false;
  // must contain a backslash command or ^/_ or common math glyphs
  if (/\\[a-zA-Z]+/.test(t)) return true;
  if (/[≠≤≥×÷±√∑∏∫∞∂∇≈≡∝∈∀∃]/.test(t)) return true;
  if (/[a-zA-Z0-9)]\^|_[{(]/.test(t)) return true;
  if (/[+\-*/=<>]/.test(t) && /[a-zA-Z0-9]/.test(t) && t.length > 1) return true;
  return false;
}
