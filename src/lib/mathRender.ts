import temml from "temml";
import { normalizeMathmlAlignment } from "./mathmlAlign";

// Render a single LaTeX expression to a MathML string (presentation MathML).
export function latexToMathml(tex: string, display = true): string {
  const cleaned = cleanLatex(tex);
  if (!cleaned.trim()) return "";
  try {
    return normalizeMathmlAlignment(
      temml.renderToString(cleaned, {
        displayMode: display,
        throwOnError: false,
        wrap: "tex",
        annotate: true,
      }),
    );
  } catch {
    try {
      return normalizeMathmlAlignment(
        temml.renderToString(cleaned, { displayMode: display, throwOnError: false }),
      );
    } catch {
      return "";
    }
  }
}

// v4: Enhanced LaTeX cleaner with more fixes for common LLM mistakes.
export function cleanLatex(tex: string): string {
  let t = tex.trim();
  if (!t) return "";
  // strip surrounding markdown code fences
  t = t.replace(/^```(?:latex|tex|math)?\s*/i, "").replace(/\s*```$/i, "");
  // strip surrounding $...$ or $$...$$ delimiters
  t = t.replace(/^\$\$+/, "").replace(/\$\$+$/, "");
  t = t.replace(/^\$+/, "").replace(/\$+$/, "");
  // strip \(...\) and \[...\]
  t = t.replace(/^\\\(/, "").replace(/\\\)$/, "");
  t = t.replace(/^\\\[/, "").replace(/\\\]$/, "");
  // collapse internal newlines so each expression sits on a single line,
  // but preserve the LaTeX row separator "\\" (which is two literal backslashes).
  t = t.replace(/\r\n?/g, "\n");
  // protect "\\"
  t = t.replace(/\\\\/g, "\u0000ROWBREAK\u0000");
  t = t.replace(/\s*\n\s*/g, " ");
  t = t.replace(/\u0000ROWBREAK\u0000/g, "\\\\");
  return t.trim();
}

/**
 * v4: Verify and clean LaTeX output from LLM OCR.
 * Returns the cleaned expression. If verification fails badly, returns "".
 */
export function verifyLatex(tex: string): { cleaned: string; valid: boolean; issues: string[] } {
  const issues: string[] = [];
  let t = cleanLatex(tex);
  if (!t) return { cleaned: "", valid: false, issues: ["empty"] };

  // 1) Strip stray markdown remnants
  if (/^```|```$/.test(t)) {
    issues.push("stray code fence");
    t = t.replace(/```/g, "");
  }

  // 2) Strip stray <math>...</math> wrapper if present
  if (/^<math>|<\/math>$/.test(t)) {
    issues.push("stray <math> tag");
    t = t.replace(/<\/?math>/gi, "");
  }

  // 3) Balance curly braces — common LLM mistake is unbalanced \frac{}{, ^{, _{
  const open = (t.match(/{/g) || []).length;
  const close = (t.match(/}/g) || []).length;
  if (open !== close) {
    if (open > close) {
      t = t + "}".repeat(open - close);
      issues.push(`added ${open - close} missing }`);
    } else {
      // can't easily prepend; just flag
      issues.push(`unbalanced braces (${open} { vs ${close} })`);
    }
  }

  // 4) Fix common typos
  t = t.replace(/\\frac([^{])/g, "\\frac{$1"); // missing { after \frac — actually skip, this is too aggressive
  // Revert that — it's too aggressive. Use safer fixes.
  t = tex; // reset
  t = cleanLatex(tex);

  // Apply safe fixes
  t = t
    // \boldsymbol -> \mathbf
    .replace(/\\boldsymbol\{/g, "\\mathbf{")
    // \R \N \Z \C \Q \H shorthands
    .replace(/\\R\b/g, "\\mathbb{R}")
    .replace(/\\N\b/g, "\\mathbb{N}")
    .replace(/\\Z\b/g, "\\mathbb{Z}")
    .replace(/\\C\b/g, "\\mathbb{C}")
    .replace(/\\Q\b/g, "\\mathbb{Q}")
    .replace(/\\H\b/g, "\\mathbb{H}")
    // \eps -> \epsilon
    .replace(/\\eps\b/g, "\\epsilon")
    // \align -> \aligned
    .replace(/\\begin\{align\*?\}/g, "\\begin{aligned}")
    .replace(/\\end\{align\*?\}/g, "\\end{aligned}")
    // \space -> \;
    .replace(/\\space\b/g, "\\;")
    // \bm{x} -> \mathbf{x}
    .replace(/\\bm\{/g, "\\mathbf{")
    // \mbox -> \text
    .replace(/\\mbox\b/g, "\\text")
    // remove trailing \\
    .replace(/\\\\\s*$/g, "")
    // fix missing space between commands: \frac\sqrt -> \frac \sqrt
    .replace(/(\\[a-zA-Z]+)(\\[a-zA-Z]+)/g, "$1 $2");

  // 5) Try rendering to validate
  let valid = true;
  try {
    temml.renderToString(t, { displayMode: true, throwOnError: true });
  } catch {
    valid = false;
    issues.push("temml parse failed");
    // Try one more cleanup pass — collapse double spaces
    t = t.replace(/\s{2,}/g, " ");
    try {
      temml.renderToString(t, { displayMode: true, throwOnError: true });
      valid = true;
      issues.pop();
    } catch {
      // last attempt: strip problematic commands
      const stripped = t
        .replace(/\\boxed\{/g, "{")
        .replace(/\\text\{([^}]*)\}/g, "$1");
      try {
        temml.renderToString(stripped, { displayMode: true, throwOnError: true });
        t = stripped;
        valid = true;
        issues.pop();
      } catch {
        // give up — keep original
      }
    }
  }

  return { cleaned: t, valid, issues };
}

/**
 * Pull LaTeX expressions out of the model's raw response.
 * All extraction paths funnel through finalize() which:
 *   1. merges chained multi-line equations (A < B < C = D) into ONE expression
 *   2. merges matrix rows (a & b \\ c & d) into ONE matrix
 *   3. dedupes
 */
export function parseExpressions(raw: string, mode: "expression" | "mixed" | "lines"): string[] {
  if (!raw) return [];
  const text = raw.trim();

  if (mode === "mixed") {
    return splitMixed(text);
  }

  let exprs: string[] = [];

  // 1) explicit <math>…</math>
  const tags = text.match(/<math>[\s\S]*?<\/math>/gi);
  if (tags && tags.length) {
    exprs = tags
      .map((s) => s.replace(/^<math>/i, "").replace(/<\/math>$/i, ""))
      .map(cleanLatex)
      .filter(Boolean);
  }

  // 2) fenced ```latex / ```tex / ```math blocks – keep environment blocks intact
  if (!exprs.length) {
    const fences = text.match(/```(?:latex|tex|math)?\s*([\s\S]*?)```/gi);
    if (fences && fences.length) {
      for (const block of fences) {
        const inner = block.replace(/^```(?:latex|tex|math)?\s*/i, "").replace(/\s*```$/i, "");
        exprs.push(...extractLatexBlocksSmart(inner));
      }
    }
  }

  // 3) explicit LaTeX environments (\begin{...} ... \end{...}) – one env = ONE expression
  if (!exprs.length) {
    exprs = extractEnvironments(text);
  }

  // 4) $$ … $$ blocks
  if (!exprs.length) {
    const dollar = [...text.matchAll(/\$\$([\s\S]*?)\$\$/g)].map((x) => cleanLatex(x[1] || ""));
    exprs = dollar.filter(Boolean);
  }

  // 5) smart block extraction (splits on blank lines, not single newlines)
  if (!exprs.length) {
    exprs = extractLatexBlocksSmart(text);
  }

  // 6) last-resort line-by-line
  if (!exprs.length) {
    exprs = text
      .split("\n")
      .map((l) => cleanLatex(l))
      .filter((l) => l && !/^(output|result|here|answer|the (equation|result|latex) is)[:\-]/i.test(l));
  }

  return finalize(exprs);
}

// final normalization shared by every extraction path
function finalize(exprs: string[]): string[] {
  if (!exprs.length) return [];
  let out = mergeChainedExpressions(exprs);
  out = mergeMatrixBlocks(out);
  return dedupe(out);
}

// ---- chain detection: the key fix for multi-line equations ----
function startsWithRelational(s: string): boolean {
  const t = s.replace(/^\s+/, "");
  if (!t) return false;
  if (/^[<>=≤≥≠≈≡∼∝⊆⊇⊂⊃∈∉→←↔⇒⇐⇔≲≳≺≻≽≼⊨⊩≪≫]/.test(t)) return true;
  if (
    /^\\(leq|geq|le|ge|lt|gt|leqslant|geqslant|neq|ne|approx|equiv|simeq|cong|sim|propto|ll|gg|lll|ggg|prec|succ|preceq|succeq|subset|supset|subseteq|supseteq|sqsubseteq|sqsupseteq|notin|ni|to|rightarrow|leftarrow|leftrightarrow|Rightarrow|Leftarrow|Leftrightarrow|mapsto|vdash|dashv|models|lesssim|gtrsim|lessgtr|gtrless|triangleq|circeq|bumpeq|asymp|doteq)\b/.test(
      t,
    )
  ) {
    return true;
  }
  if (/^\\in\b/.test(t)) return true;
  return false;
}

function endsComplete(s: string): boolean {
  const t = s.trim();
  return /[.;]$/.test(t);
}

function mergeChainedExpressions(exprs: string[]): string[] {
  if (exprs.length < 2) return exprs;
  const result: string[] = [];
  let chain: string[] = [];

  const flush = () => {
    if (!chain.length) return;
    if (chain.length === 1) {
      result.push(chain[0]);
    } else {
      result.push("\\begin{gathered} " + chain.map((c) => c.trim()).join(" \\\\ ") + " \\end{gathered}");
    }
    chain = [];
  };

  for (const e of exprs) {
    const last = chain.length ? chain[chain.length - 1] : "";
    const isContinuation =
      chain.length > 0 && !endsComplete(last) && startsWithRelational(e);

    if (isContinuation) {
      chain.push(e);
    } else {
      flush();
      chain = [e];
    }
  }
  flush();
  return result;
}

// ---- smart block extraction: keep \begin...\end as one unit ----
const ENV_NAMES = [
  "gathered", "gather", "aligned", "align", "alignat",
  "matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix",
  "array", "cases", "dcases", "system", "split", "multline",
  "smallmatrix", "subarray", "equation", "eqnarray",
];

function extractEnvironments(src: string): string[] {
  const out: string[] = [];
  const re = new RegExp(
    "\\\\begin\\{(" + ENV_NAMES.join("|") + ")\\*?\\}[\\s\\S]*?\\\\end\\{\\1\\*?\\}",
    "gi",
  );
  let match: RegExpExecArray | null;
  while ((match = re.exec(src)) !== null) {
    out.push(cleanLatex(match[0]));
  }
  if (out.length) return dedupe(out);

  const disp = [...src.matchAll(/\\\[([\s\S]*?)\\\]/g)].map((x) => cleanLatex(x[1]));
  return dedupe(disp.filter(Boolean));
}

function extractLatexBlocksSmart(src: string): string[] {
  const blocks: { start: number; end: number; text: string }[] = [];
  const reEnv = new RegExp(
    "\\\\begin\\{(" + ENV_NAMES.join("|") + ")\\*?\\}[\\s\\S]*?\\\\end\\{\\1\\*?\\}",
    "gi",
  );
  let m: RegExpExecArray | null;
  while ((m = reEnv.exec(src)) !== null) {
    blocks.push({ start: m.index, end: reEnv.lastIndex, text: cleanLatex(m[0]) });
  }
  if (blocks.length) {
    const out = blocks.map((b) => b.text);
    let last = 0;
    const extras: string[] = [];
    for (const b of blocks) {
      const between = src.slice(last, b.start).trim();
      if (between) extras.push(...between.split(/\n{2,}|\n/).map(cleanLatex).filter(Boolean));
      last = b.end;
    }
    const tail = src.slice(last).trim();
    if (tail) extras.push(...tail.split(/\n{2,}|\n/).map(cleanLatex).filter(Boolean));
    return dedupe([...out, ...extras]);
  }

  const parts = src.split(/\n\s*\n+/).map((p) => cleanLatex(p)).filter(Boolean);
  if (parts.length > 1) return dedupe(parts);
  return src.split("\n").map(cleanLatex).filter(Boolean);
}

function mergeMatrixBlocks(exprs: string[]): string[] {
  if (exprs.length < 2) return exprs;
  const out: string[] = [];
  let buf: string[] = [];
  for (const e of exprs) {
    const looksRow =
      /&/.test(e) && !e.includes("\\begin") && !e.includes("\\end") && !e.includes("gathered") && e.length < 260;
    if (looksRow) {
      buf.push(e.replace(/\\\\\s*$/, ""));
    } else {
      if (buf.length >= 2) {
        out.push("\\begin{bmatrix} " + buf.join(" \\\\ ") + " \\end{bmatrix}");
        buf = [];
      } else if (buf.length === 1) {
        out.push(buf[0]);
        buf = [];
      }
      out.push(e);
    }
  }
  if (buf.length >= 2) {
    out.push("\\begin{bmatrix} " + buf.join(" \\\\ ") + " \\end{bmatrix}");
  } else {
    out.push(...buf);
  }
  return dedupe(out);
}

// Mixed mode: keep the surrounding text but lift out inline/display math.
function splitMixed(text: string): string[] {
  const parts: string[] = [];
  const re = /\$\$([\s\S]*?)\$\$|\$([^$\n]+)\$|\\\(([\s\S]*?)\\\)|\[([\s\S]*?)\]/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const between = text.slice(last, match.index).trim();
    if (between) parts.push("\\text{" + between.replace(/[{}]/g, " ") + "}");
    const expr = cleanLatex(match[1] || match[2] || match[3] || match[4] || "");
    if (expr) parts.push(expr);
    last = re.lastIndex;
  }
  const tail = text.slice(last).trim();
  if (tail) parts.push("\\text{" + tail.replace(/[{}]/g, " ") + "}");
  return parts.length ? parts : [cleanLatex(text)];
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const key = s.replace(/\s+/g, " ");
    if (s && !seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

// Render an arbitrary text/assistant message — render any $…$ / $$…$$ / \(\) math.
export function renderRichText(text: string): { type: "text" | "math"; value: string; display: boolean }[] {
  const re = /\$\$([\s\S]*?)\$\$|\$([^$\n]+)\$|\\\(([\s\S]*?)\\\)|\[([\s\S]*?)\]/g;
  const out: { type: "text" | "math"; value: string; display: boolean }[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) out.push({ type: "text", value: text.slice(last, match.index), display: false });
    const display = !!(match[1] || match[4]);
    out.push({ type: "math", value: match[1] || match[2] || match[3] || match[4] || "", display });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last), display: false });
  return out.length ? out : [{ type: "text", value: text, display: false }];
}
