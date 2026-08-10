// Deterministic checks the agent runs against its own draft.
//
// The self-audit pass asks the model to review its work, which catches reasoning
// mistakes but is unreliable on exactly the things a computer is good at: whether
// `47 * 83 = 3901` is true, and whether a block of LaTeX actually parses. Those are
// decided here instead, with real arithmetic and a real parser, so the defect list
// handed to the revision pass contains facts rather than another opinion.
//
// Nothing here calls a model or the network. `eval` is not used — the expression
// parser is a small recursive-descent one, so a draft containing
// `\text{process.exit()}` is data, not code.

import { verifyLatex } from "./mathRender";

export interface ToolFinding {
  /** Which check produced this. Shown as the source in the trace. */
  tool: string;
  /** One line, specific enough for the revision pass to act on. */
  detail: string;
}

export interface ToolRunResult {
  findings: ToolFinding[];
  /** Human-readable account of what ran, for the thinking window. */
  log: string[];
}

// ── expression evaluator ───────────────────────────────────────────────────

type Tok = { t: "num"; v: number } | { t: "op"; v: string };

/**
 * Tokenise a plain arithmetic expression. Returns null the moment anything
 * unrecognised appears, which is the common case — most of a maths answer is not
 * a checkable arithmetic claim, and a wrong "issue" is worse than no issue.
 */
function tokenize(src: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  const s = src
    .replace(/\\cdot|\\times/g, "*")
    .replace(/\\div/g, "/")
    .replace(/\\left|\\right/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, "");
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const v = Number(s.slice(i, j));
      if (!Number.isFinite(v)) return null;
      out.push({ t: "num", v });
      i = j;
      continue;
    }
    if ("+-*/^()".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    return null; // a letter, a symbol, an unknown macro — not plain arithmetic
  }
  return out.length ? out : null;
}

/** Recursive-descent evaluator over the token list. Returns null on any malformity. */
function evaluate(toks: Tok[]): number | null {
  let p = 0;
  const peek = () => toks[p];
  const eat = (v: string) => {
    const t = peek();
    if (t && t.t === "op" && t.v === v) { p++; return true; }
    return false;
  };

  const primary = (): number | null => {
    if (eat("(")) {
      const v = expr();
      if (v === null || !eat(")")) return null;
      return v;
    }
    if (eat("-")) { const v = primary(); return v === null ? null : -v; }
    if (eat("+")) return primary();
    const t = peek();
    if (t && t.t === "num") { p++; return t.v; }
    return null;
  };
  // Right-associative, as `2^3^2` is in maths.
  const power = (): number | null => {
    const base = primary();
    if (base === null) return null;
    if (eat("^")) {
      const ex = power();
      return ex === null ? null : Math.pow(base, ex);
    }
    return base;
  };
  const term = (): number | null => {
    let v = power();
    if (v === null) return null;
    for (;;) {
      if (eat("*")) { const r = power(); if (r === null) return null; v *= r; }
      else if (eat("/")) { const r = power(); if (r === null) return null; if (r === 0) return null; v /= r; }
      else return v;
    }
  };
  const expr = (): number | null => {
    let v = term();
    if (v === null) return null;
    for (;;) {
      if (eat("+")) { const r = term(); if (r === null) return null; v += r; }
      else if (eat("-")) { const r = term(); if (r === null) return null; v -= r; }
      else return v;
    }
  };

  const v = expr();
  return p === toks.length ? v : null;
}

/** Evaluate a plain-arithmetic string, or null if it is not one. */
export function evalArithmetic(src: string): number | null {
  const toks = tokenize(src);
  return toks ? evaluate(toks) : null;
}

// ── checks ─────────────────────────────────────────────────────────────────

/** Strip fenced code so a Python snippet is not audited as if it were prose maths. */
function withoutCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ");
}

const REL = /([0-9][0-9\s.+\-*/^()]*?(?:\\cdot|\\times|\\div)?[0-9\s.+\-*/^(){}]*?)\s*=\s*(-?[0-9][0-9.]*)(?![0-9.]*[a-zA-Z\\])/g;

/**
 * Verify numeric equalities the draft asserts.
 *
 * Only fully-numeric claims are considered: `2^{10} = 1024` is checked, `x + 1 = 3`
 * is not, since the left side is not a number. A tolerance is applied because a
 * correct answer may legitimately be rounded, and flagging `1/3 = 0.333` as wrong
 * would be noise.
 */
export function arithmeticIssues(text: string): string[] {
  const src = withoutCode(text);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of src.matchAll(REL)) {
    const lhsRaw = m[1].trim();
    const rhsRaw = m[2].trim();
    if (!/[+\-*/^]|\\cdot|\\times|\\div/.test(lhsRaw)) continue; // `5 = 5` proves nothing
    const lhs = evalArithmetic(lhsRaw);
    const rhs = Number(rhsRaw);
    if (lhs === null || !Number.isFinite(rhs)) continue;
    const scale = Math.max(1, Math.abs(lhs), Math.abs(rhs));
    if (Math.abs(lhs - rhs) <= 1e-6 * scale) continue;
    // Rounded-to-integer and similar presentations are not errors.
    if (Math.abs(lhs - rhs) < 0.5 && !Number.isInteger(lhs)) continue;
    const key = `${lhsRaw}=${rhsRaw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`Arithmetic is wrong: "${lhsRaw} = ${rhsRaw}" — the left side evaluates to ${Number(lhs.toPrecision(12))}.`);
    if (out.length >= 4) break;
  }
  return out;
}

/** LaTeX in the draft that will not render. Cheap, and invisible to the model. */
export function latexIssues(text: string): string[] {
  const blocks = [
    ...text.matchAll(/\$\$([\s\S]+?)\$\$/g),
    ...text.matchAll(/\\\[([\s\S]+?)\\\]/g),
  ];
  const out: string[] = [];
  for (const m of blocks) {
    const { valid, issues } = verifyLatex(m[1]);
    if (!valid && issues.length) {
      out.push(`LaTeX will not render: "${m[1].trim().slice(0, 60)}…" — ${issues[0]}`);
    }
    if (out.length >= 3) break;
  }
  return out;
}

/** Parts of a multi-part question the draft never came back to. */
export function unansweredParts(question: string, draft: string): string[] {
  const labels = [...question.matchAll(/(?:^|\s)\(([a-e])\)/gi)].map((m) => m[1].toLowerCase());
  const unique = [...new Set(labels)];
  if (unique.length < 2) return [];
  const missing = unique.filter((l) => !new RegExp(`\\(${l}\\)|\\b${l}\\)`, "i").test(draft));
  return missing.length ? [`Part (${missing.join("), (")}) of the question is not answered in the draft.`] : [];
}

/**
 * Run every deterministic check and report both the findings and what was run.
 * The log matters as much as the findings: a trace that says "checked arithmetic,
 * found nothing" is evidence the check happened, which "no issues" alone is not.
 */
export function runChecks(question: string, draft: string): ToolRunResult {
  const arith = arithmeticIssues(draft);
  const tex = latexIssues(draft);
  const parts = unansweredParts(question, draft);
  const findings: ToolFinding[] = [
    ...arith.map((detail) => ({ tool: "arithmetic", detail })),
    ...tex.map((detail) => ({ tool: "latex", detail })),
    ...parts.map((detail) => ({ tool: "coverage", detail })),
  ];
  const log = [
    `arithmetic — recomputed every numeric equality: ${arith.length ? `${arith.length} wrong` : "all check out"}`,
    `latex — parsed every display block: ${tex.length ? `${tex.length} will not render` : "all parse"}`,
    `coverage — matched question parts against the draft: ${parts.length ? "gap found" : "no gap"}`,
  ];
  return { findings, log };
}
