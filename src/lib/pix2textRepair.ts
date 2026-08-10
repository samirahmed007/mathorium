// Pix2Text output repair — the "post-process agent".
//
// The raw MFR decoder is a small VisionEncoderDecoder trained on a LaTeX corpus that
// was itself normalized by a tokenizer. Its output is therefore *structurally* right
// but *textually* denormalized in a handful of very consistent ways. `pix2text.ts`
// already ports upstream's own cleanup chain (unmatched \left\right, empty accents,
// whitespace); this module is the layer above it, and it targets the defects that
// upstream does NOT fix and that were measured across all 39 Test_Image formulas.
//
// Every rule here is evidence-driven — the comment on each names the images that
// motivated it. Nothing is speculative, because a "helpful" rewrite that fires on a
// pattern the model never emits is pure risk: it can only ever corrupt correct output.
//
// The whole chain is deliberately *display-preserving*: it changes how the LaTeX is
// written, never what it renders as. That is what makes it safe to apply to an
// already-converted result after the fact (the Convert tab's "Repair" action) and
// safe to run twice — every rule is idempotent.

export interface RepairIssue {
  /** Stable rule id, so the UI can group and explain repairs. */
  rule: string;
  /** Human-readable one-liner shown in the result card. */
  label: string;
  /** How many times this rule fired. */
  count: number;
}

export interface RepairResult {
  latex: string;
  issues: RepairIssue[];
  changed: boolean;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * `\overline{{c}}` → `\overline{c}` — the single most common defect in the corpus.
 *
 * The training corpus wrote every accent/group argument as a brace group, and the
 * tokenizer preserved the redundant inner pair, so the decoder reproduces it. It
 * renders identically, but it matters for three reasons: it is what the user sees
 * in the LaTeX box, MathML export nests a pointless <mrow>, and downstream tools
 * that pattern-match on `\overline{c}` miss it.
 *
 * Measured on 5848-7, -9, -10, -24, -51, -55, -87, -167, -200, -201, -309, -326
 * (`\overline { { c } }`) and on the `{ { } \mathrm{if} ... }` cases rows of -11.
 *
 * Only stripped when the inner group is the *entire* argument — `{{a}{b}}` is two
 * separate groups and must stay, and `{{a}+{b}}` is not a redundant wrapper either.
 */
function stripDoubledBraces(tex: string): { out: string; count: number } {
  let count = 0;
  let out = tex;
  // Iterate: `{{{c}}}` needs more than one pass, and each pass is a strict
  // reduction so this always terminates.
  for (let i = 0; i < 8; i++) {
    // A brace group whose content is exactly one balanced brace group. The inner
    // body must not itself contain braces, which keeps the match unambiguous
    // without needing a real parser.
    const next = out.replace(/\{\s*\{([^{}]*)\}\s*\}/g, (_m, body: string) => {
      count++;
      return `{${body}}`;
    });
    if (next === out) break;
    out = next;
  }
  return { out, count };
}

/**
 * `\operatorname{l o g}` → `\log`, `\operatorname*{m i n}` → `\min`.
 *
 * pix2text.ts::collapseSpacedOperators already does this for the *spaced* form, but
 * the decoder also emits the unspaced `\operatorname{log}` (5848-24, -26, -46, -49)
 * where a real command exists. Rewriting it matters for MathML export: temml emits
 * `\operatorname{log}` as an <mi> with no operator spacing, while `\log` gets the
 * correct <mo> treatment and thin space before its argument.
 */
const KNOWN_OPERATORS = new Set([
  "arccos", "arcsin", "arctan", "arg", "cos", "cosh", "cot", "coth", "csc",
  "deg", "det", "dim", "exp", "gcd", "hom", "inf", "ker", "lg", "lim",
  "liminf", "limsup", "ln", "log", "max", "min", "Pr", "sec", "sin",
  "sinh", "sup", "tan", "tanh",
]);

function canonicalizeOperators(tex: string): { out: string; count: number } {
  let count = 0;
  const out = tex.replace(/\\operatorname(\*?)\s*\{\s*([A-Za-z][A-Za-z\s]*?)\s*\}/g, (m, _star: string, body: string) => {
    const name = body.replace(/\s+/g, "");
    if (!KNOWN_OPERATORS.has(name)) return m;
    count++;
    return `\\${name}`;
  });
  return { out, count };
}

/**
 * `{ \cal N }` → `\mathcal{N}`, `{ \bf x }` → `\mathbf{x}`.
 *
 * The decoder emits TeX 2.09 font switches (5848-50: `{ \cal N } ( 1 , \sigma^2 )`).
 * These are deprecated, KaTeX supports them only in compatibility mode, and temml
 * does not implement `\cal` at all — so MathML export silently loses the calligraphic
 * script, turning `𝒩(1,σ²)` into `N(1,σ²)`. That is a real loss of meaning: 𝒩 is the
 * normal distribution. Rewriting to the LaTeX2e form fixes the export.
 */
const FONT_SWITCHES: Record<string, string> = {
  cal: "mathcal",
  bf: "mathbf",
  it: "mathit",
  rm: "mathrm",
  sf: "mathsf",
  tt: "mathtt",
  scr: "mathscr",
  frak: "mathfrak",
  bb: "mathbb",
};

function modernizeFontSwitches(tex: string): { out: string; count: number } {
  let count = 0;
  const names = Object.keys(FONT_SWITCHES).join("|");
  // `{ \cal N }` — the switch is the first thing in the group and scopes to its end.
  const re = new RegExp(`\\{\\s*\\\\(${names})\\s+([^{}]*?)\\s*\\}`, "g");
  let out = tex;
  for (let i = 0; i < 4; i++) {
    const next = out.replace(re, (_m, sw: string, body: string) => {
      count++;
      return `\\${FONT_SWITCHES[sw]}{${body.trim()}}`;
    });
    if (next === out) break;
    out = next;
  }
  return { out, count };
}

/**
 * `~` → `\,` inside math.
 *
 * 5848-50 decodes as `( 1 , ~ \sigma_{\varepsilon}^{2} )`. In math mode `~` is a
 * non-breaking space, which KaTeX renders but temml exports as a literal `&nbsp;`
 * inside an <mtext> — visible junk in the MathML. `\,` is the thin space the source
 * actually shows after a comma.
 *
 * Scoped to a `~` that follows a comma or an opening delimiter, which is the only
 * shape the decoder produces; a `~` used as a relation (`a ~ b`) is left alone.
 */
function normalizeTildeSpaces(tex: string): { out: string; count: number } {
  let count = 0;
  const out = tex.replace(/([,;(\[])\s*~\s*/g, (_m, pre: string) => {
    count++;
    return `${pre}\\,`;
  });
  return { out, count };
}

/**
 * Balance braces that are genuinely unpaired.
 *
 * A truncated decode (token cap hit mid-expression) leaves `\frac{1}{2` — KaTeX
 * hard-errors and renders nothing at all, so the user sees a blank result instead of
 * *almost* the right formula. Appending the missing closers recovers a renderable
 * expression. Escaped `\{` / `\}` are literal delimiters and are not counted.
 *
 * Deliberately conservative: only *appends* missing `}`. A surplus `}` cannot be
 * fixed by guessing where the `{` belonged, so it is reported and left in place.
 */
function balanceBraces(tex: string): { out: string; count: number; surplus: number } {
  let depth = 0;
  let surplus = 0;
  for (let i = 0; i < tex.length; i++) {
    if (tex[i] === "\\") {
      i++; // skip the escaped char, so \{ and \} never count
      continue;
    }
    if (tex[i] === "{") depth++;
    else if (tex[i] === "}") {
      if (depth > 0) depth--;
      else surplus++;
    }
  }
  return { out: depth > 0 ? tex + "}".repeat(depth) : tex, count: depth, surplus };
}

/**
 * Drop the trailing `\\` that `\begin{array}` rows end with.
 *
 * The cases blocks in 5848-8 and -11 decode with a final row separator before
 * `\end{array}`. KaTeX tolerates it, but temml emits a trailing empty <mtr>, so the
 * exported MathML grows a blank row that isn't in the source.
 */
function dropTrailingRowSeparator(tex: string): { out: string; count: number } {
  let count = 0;
  const out = tex.replace(/\\\\\s*(\\end\s*\{(?:array|matrix|pmatrix|bmatrix|vmatrix|cases|aligned)\})/g, (_m, end: string) => {
    count++;
    return end;
  });
  return { out, count };
}

/**
 * Remove a sentence-ending period left dangling after a display formula.
 *
 * 5848-8 and -11 end `\right. .` — the first `.` is the (required) null delimiter of
 * `\right.`, the second is the prose full stop that followed the formula in the
 * source page. Kept as math it renders as a stray floating dot. Only the specific
 * `\right.` + separated `.` shape is touched, so a legitimate trailing period
 * elsewhere (decimal points, `\ldots`) is unaffected.
 */
function dropDanglingPeriod(tex: string): { out: string; count: number } {
  let count = 0;
  const out = tex.replace(/(\\right\s*\.)\s+\.\s*$/g, (_m, right: string) => {
    count++;
    return right;
  });
  return { out, count };
}

/**
 * Restore the space the decoder drops between a command and its argument.
 *
 * `pix2text.ts::removeUnnecessarySpaces` strips whitespace aggressively, which turns
 * `\Phi ( x )` into `\Phi( x )` and `x \to 0` into `x \to0` (5848-2, -3, -4, -24).
 * That is valid LaTeX and renders correctly, but `\to0` is unreadable in the editor
 * and `\sigma/ 2` reads as a typo. Re-inserting one space after a multi-letter
 * command restores conventional formatting without changing the render.
 */
function respaceCommands(tex: string): { out: string; count: number } {
  let count = 0;
  // A command followed immediately by a digit, `(`, `[`, or `\` — never by a letter
  // (that would change which command it is) and never by `{` (which is already
  // unambiguous and conventionally written tight).
  const out = tex.replace(/(\\[a-zA-Z]{2,})(?=[0-9(\[])/g, (m) => {
    count++;
    return `${m} `;
  });
  return { out, count };
}

/**
 * Fix a manual delimiter size whose laterality contradicts its delimiter.
 *
 * 5848-309 decodes as `\Biggl [ 1 + \frac{\tilde z}{\sigma_s} \Biggl ]` — the closing
 * bracket carries `\Biggl` (an *opening* size) instead of `\Biggr`. This is the
 * headline "bracket issue": TeX's `l`/`r` suffix sets the spacing class, so a `\Biggl]`
 * is typeset as an opening delimiter and gets opening-side spacing. The bracket leans
 * the wrong way and the visual grouping of the inequality breaks down — on -309 the
 * two bracketed factors stop reading as separate products.
 *
 * The rule is purely local and unambiguous: `[` `(` `\{` `\langle` `\lfloor` `\lceil`
 * are openers, `]` `)` `\}` `\rangle` `\rfloor` `\rceil` are closers, so the suffix is
 * fully determined by the delimiter that follows. Neutral delimiters (`|`, `\|`, `.`,
 * `/`) genuinely can be either and are left untouched.
 */
const OPENERS = new Set(["(", "[", "\\{", "\\langle", "\\lfloor", "\\lceil", "\\lgroup", "\\lmoustache", "<"]);
const CLOSERS = new Set([")", "]", "\\}", "\\rangle", "\\rfloor", "\\rceil", "\\rgroup", "\\rmoustache", ">"]);

function fixDelimiterLaterality(tex: string): { out: string; count: number } {
  let count = 0;
  // \big \Big \bigg \Bigg, each optionally suffixed l/r, then a delimiter token.
  const re = /\\(b|B)(ig|igg)([lr])?\s*(\\[a-zA-Z]+|\\\{|\\\}|[()\[\]<>|.\/])/g;
  const out = tex.replace(re, (m, bB: string, size: string, side: string | undefined, delim: string) => {
    const want = OPENERS.has(delim) ? "l" : CLOSERS.has(delim) ? "r" : null;
    if (!want || !side || side === want) return m;
    count++;
    return `\\${bB}${size}${want}${delim}`;
  });
  return { out, count };
}

/**
 * `\left(` … `\right]` with mismatched *shapes* is legal LaTeX and sometimes
 * intended (half-open intervals), so it is only reported, never rewritten. What is
 * always wrong is an unpaired `\left`/`\right`, and `pix2text.ts::fixLatex` already
 * blanks those before this module runs.
 *
 * This check exists so the result card can flag "delimiters may be mismatched" for
 * human review rather than silently guessing.
 */
function countLeftRight(tex: string): { lefts: number; rights: number } {
  const lefts = (tex.match(/\\left(?![a-zA-Z])/g) || []).length;
  const rights = (tex.match(/\\right(?![a-zA-Z])/g) || []).length;
  return { lefts, rights };
}

/**
 * Count unmatched bare `(`/`)` and `[`/`]`.
 *
 * Three images in the corpus decode with a genuinely mismatched delimiter count:
 * 5848-5 has a surplus `(`, 5848-317 a surplus `[`, 5848-328 a surplus `]`. These are
 * *misreads* — the model dropped or invented a delimiter — not notation quirks, and
 * they render without error (bare delimiters need no partner in TeX), which is exactly
 * what makes them dangerous: the formula looks fine and is subtly wrong.
 *
 * They are reported and never rewritten. Inserting a delimiter means choosing where it
 * goes, and there are usually several defensible positions with different mathematical
 * meanings. Guessing would convert a visible defect into an invisible one. Flagging
 * sends the user to the two or three images that actually need an eye, which is the
 * honest and more useful outcome — 5848-5 is the case that settles the argument: the
 * *source page itself* has the unbalanced `(`, so the engine was right and any
 * "correction" would have made it disagree with the paper.
 *
 * Delimiters attached to `\left`/`\right` are skipped. TeX pairs those structurally,
 * so `\left\{ … \right.` is balanced even though only one brace glyph appears — and
 * counting the glyphs instead of the pairs is what made 5848-8 and 5848-11 report a
 * phantom "unclosed \{" on two perfectly correct cases blocks.
 */
function delimiterBalance(tex: string): { paren: number; square: number } {
  let paren = 0;
  let square = 0;
  // Blank out every \left…/\right… delimiter first, so only bare glyphs are counted.
  const bare = tex.replace(
    /\\(?:left|right|[bB]igg?[lrm]?)\s*(?:\\[a-zA-Z]+|\\\{|\\\}|\\\||[()\[\]<>|.\/])/g,
    " ",
  );
  for (let i = 0; i < bare.length; i++) {
    if (bare[i] === "\\") {
      i++; // \( \) \[ \] are escapes, not delimiters
      continue;
    }
    const c = bare[i];
    if (c === "(") paren++;
    else if (c === ")") paren--;
    else if (c === "[") square++;
    else if (c === "]") square--;
  }
  return { paren, square };
}

/**
 * `\d` → `d` — a letter the decoder emitted as a control sequence.
 *
 * 5848-326 decodes `F_{\dddot{\d}}` and `\mu_{\d J}`, where the source simply has the
 * letter `d`. `\d` is a *text-mode* underdot accent in LaTeX and is undefined in math
 * mode, so KaTeX and temml both hard-fail the entire expression: the user gets a red
 * error box instead of a formula that is otherwise 95% correct.
 *
 * The letter list is not guesswork — it is exactly the set of single-letter control
 * sequences KaTeX rejects in math mode, enumerated by probing `x \<letter> y` for all
 * 52 ASCII letters. The valid ones (`\c \r \u \v \H \N \P \R \S \Z` — accents and real
 * symbols) are deliberately excluded, so this rule can only ever fire on input that
 * was already unrenderable. That makes it strictly an improvement.
 */
const INVALID_LETTER_COMMANDS = new Set(
  "a b d e f g h i j k l m n o p q s t w x y z A B C D E F G I J K L M O Q T U V W X Y".split(" "),
);

function repairLetterCommands(tex: string): { out: string; count: number } {
  let count = 0;
  const out = tex.replace(/\\([A-Za-z])(?![A-Za-z])/g, (m, ch: string) => {
    if (!INVALID_LETTER_COMMANDS.has(ch)) return m;
    count++;
    return ch;
  });
  return { out, count };
}

/** Collapse runs of whitespace, and tidy the spacing around binary operators. */
function normalizeSpacing(tex: string): string {
  return tex
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,;])/g, "$1")
    .replace(/\{\s+/g, "{")
    .replace(/\s+\}/g, "}")
    .trim();
}

// ---------------------------------------------------------------------------
// Chain
// ---------------------------------------------------------------------------

interface Rule {
  id: string;
  label: string;
  run: (tex: string) => { out: string; count: number; surplus?: number };
}

const RULES: Rule[] = [
  { id: "letter-commands", label: "Repaired letters read as commands", run: repairLetterCommands },
  { id: "delimiter-laterality", label: "Corrected left/right bracket sizing", run: fixDelimiterLaterality },
  { id: "doubled-braces", label: "Removed redundant nested braces", run: stripDoubledBraces },
  { id: "operators", label: "Canonicalized operator names", run: canonicalizeOperators },
  { id: "font-switches", label: "Modernized TeX font switches", run: modernizeFontSwitches },
  { id: "tilde-space", label: "Replaced ~ with a thin space", run: normalizeTildeSpaces },
  { id: "row-separator", label: "Removed trailing row separator", run: dropTrailingRowSeparator },
  { id: "dangling-period", label: "Removed dangling sentence period", run: dropDanglingPeriod },
  { id: "respace", label: "Restored spacing after commands", run: respaceCommands },
];

/**
 * Repair one Pix2Text expression. Idempotent and display-preserving, so it is safe
 * to run on raw engine output during conversion *and* on an already-converted
 * result later, without the two producing different answers.
 */
export function repairPix2TextLatex(input: string): RepairResult {
  const original = input;
  let tex = input;
  const issues: RepairIssue[] = [];

  for (const rule of RULES) {
    const { out, count } = rule.run(tex);
    if (count > 0) issues.push({ rule: rule.id, label: rule.label, count });
    tex = out;
  }

  // Brace balancing runs last: the rules above can legitimately remove braces, and
  // balancing before them would append closers that then become surplus.
  const bal = balanceBraces(tex);
  if (bal.count > 0) {
    issues.push({ rule: "unbalanced-braces", label: `Closed ${bal.count} unclosed brace${bal.count > 1 ? "s" : ""}`, count: bal.count });
    tex = bal.out;
  }
  if (bal.surplus > 0) {
    // Reported but not "fixed" — see balanceBraces.
    issues.push({ rule: "surplus-braces", label: `${bal.surplus} unmatched closing brace${bal.surplus > 1 ? "s" : ""} (left as-is)`, count: bal.surplus });
  }

  // Flag, never rewrite — see countLeftRight.
  const lr = countLeftRight(tex);
  if (lr.lefts !== lr.rights) {
    issues.push({
      rule: "leftright-imbalance",
      label: `\\left/\\right counts differ (${lr.lefts} vs ${lr.rights}) — check delimiters`,
      count: Math.abs(lr.lefts - lr.rights),
    });
  }

  // Flag, never rewrite — see delimiterBalance.
  const db = delimiterBalance(tex);
  if (db.paren !== 0) {
    issues.push({
      rule: "paren-imbalance",
      label: `${Math.abs(db.paren)} unmatched ${db.paren > 0 ? "(" : ")"} — verify against the image`,
      count: Math.abs(db.paren),
    });
  }
  if (db.square !== 0) {
    issues.push({
      rule: "bracket-imbalance",
      label: `${Math.abs(db.square)} unmatched ${db.square > 0 ? "[" : "]"} — verify against the image`,
      count: Math.abs(db.square),
    });
  }

  tex = normalizeSpacing(tex);
  return { latex: tex, issues, changed: tex !== original };
}

/** Repair a list of expressions, merging their issue counts into one summary. */
export function repairPix2TextExpressions(exprs: string[]): { expressions: string[]; issues: RepairIssue[]; changed: boolean } {
  const merged = new Map<string, RepairIssue>();
  let changed = false;
  const expressions = exprs.map((e) => {
    const r = repairPix2TextLatex(e);
    if (r.changed) changed = true;
    for (const iss of r.issues) {
      const prev = merged.get(iss.rule);
      if (prev) prev.count += iss.count;
      else merged.set(iss.rule, { ...iss });
    }
    return r.latex;
  });
  return { expressions, issues: [...merged.values()], changed };
}

// ---------------------------------------------------------------------------
// Delimiter shape reconciliation (token level)
// ---------------------------------------------------------------------------
//
// The rules above work on the finished LaTeX string. This one cannot: the single
// most damaging thing the decoder does is emit a delimiter of the *wrong shape* —
// a tall `(` read as `[` — and that error is completely invisible in the text,
// because `[…]` is a perfectly well-formed pair. Balance checking cannot see it,
// and no amount of string rewriting can recover the answer.
//
// What can see it is the decoder's own distribution. Measured over every delimiter
// token in the 39-image Test_Image corpus, the margin between the emitted glyph and
// its nearest same-side rival shape is sharply bimodal: 67 of 86 delimiters sit above
// 7 nats, and the ones below 5 cluster almost entirely in the two formulas whose
// brackets are actually wrong. A confident delimiter is essentially never mistaken;
// an uncertain one is a coin flip the model is resolving with its language-model
// prior rather than with what it saw.
//
// Uncertainty alone still does not say *which* shape is right, so a low margin is
// never enough on its own to rewrite. The reconciliation below requires corroborating
// evidence from the rest of the same formula — see reconcileDelimiterShapes.

/**
 * Delimiter glyphs the decoder confuses with one another, grouped by side.
 *
 * Only these three pairs are included. `\langle`/`\rangle`, `\lfloor`/`\rfloor` and
 * friends are visually distinctive and never appeared as a runner-up to a bracket
 * anywhere in the corpus, so admitting them would only add ways to be wrong.
 */
const SHAPE_SIDE: Record<string, "open" | "close"> = {
  "(": "open",
  "[": "open",
  "\\{": "open",
  ")": "close",
  "]": "close",
  "\\}": "close",
};

/**
 * Margin (in nats of log-probability) below which a delimiter is treated as a
 * coin flip between two shapes rather than a recognition.
 *
 * Chosen from the measured distribution, not picked by feel: the corpus histogram
 * has a clear gap between 5 and 7 nats, with only 3 of 86 delimiters landing inside
 * it. Every delimiter that visual comparison proved wrong falls below 5; every
 * delimiter above 7 was correct.
 */
const DELIM_AMBIGUOUS_MARGIN = 5;

/** One decoding step's candidate list, best first. Structurally a TokenAlternative[]. */
type StepCandidates = { id: number; text: string; logProb: number }[];

export interface DelimiterFlag {
  /** Index into the generated token sequence. */
  index: number;
  /** Shape the decoder emitted. */
  from: string;
  /** Shape it very nearly emitted instead. */
  to: string;
  /** How close the call was, in nats. */
  margin: number;
}

export interface DelimiterReconcileResult {
  /** Token index → replacement token id, for steps the evidence settles. */
  fixes: Map<number, number>;
  /** Close calls the evidence could not settle. These need a human and the image. */
  flags: DelimiterFlag[];
  issues: RepairIssue[];
}

/**
 * Correct delimiters whose shape the decoder was unsure about, using the rest of
 * the formula as evidence.
 *
 * The inference is a consensus argument. Within one formula the decoder is
 * internally consistent about a glyph it can actually see: if a real `[` is present,
 * at least one of them comes out with a large margin. So when a shape is *never*
 * confidently attested anywhere in the formula, yet keeps showing up as the narrow
 * winner over a shape that *is* confidently attested, the narrow wins are the model's
 * prior leaking through — not a reading. Those get flipped to the attested shape.
 *
 * Worked through the three corpus formulas that have ambiguous delimiters:
 *
 *   5848-317 — every delimiter in the source is a parenthesis. The decoder emitted 12
 *     brackets, all with margins between 0.27 and 4.30, and not one confident `[` or
 *     `]` anywhere; meanwhile 15 parens came out at margins of 6–12.7. Consensus fires
 *     and every bracket is corrected. This is the user-reported failure, fixed.
 *
 *   5848-328 — genuinely mixes both shapes: `φ(…)[…]`. `[` is confidently attested
 *     (6.34) alongside confident parens, so consensus deliberately does *not* fire and
 *     the ambiguous delimiters are flagged for the eye instead. Guessing here would
 *     have corrupted the correct half of the formula.
 *
 *   5848-5  — the source itself contains an unbalanced `(` (a typo in the original
 *     paper) which the decoder reproduced faithfully. No delimiter is ambiguous, so
 *     nothing is touched. Rewriting it would have "fixed" the engine into disagreeing
 *     with the page.
 *
 * Fires on 1 formula in 39. That is the point: it is a precision instrument for a
 * specific, verified failure, not a blanket normalizer.
 */
export function reconcileDelimiterShapes(alternatives: StepCandidates[]): DelimiterReconcileResult {
  interface Slot {
    index: number;
    shape: string;
    margin: number;
    rival?: { id: number; text: string };
  }

  const slots: Slot[] = [];
  alternatives.forEach((cands, i) => {
    const emitted = (cands?.[0]?.text || "").trim();
    const side = SHAPE_SIDE[emitted];
    if (!side) return;
    // Only a rival on the *same side* is evidence about shape. A `]` losing ground to
    // `^` says nothing about brackets; a `]` losing to `)` says everything.
    const rival = cands.slice(1).find((c) => {
      const t = (c.text || "").trim();
      return SHAPE_SIDE[t] === side && t !== emitted;
    });
    slots.push({
      index: i,
      shape: emitted,
      margin: rival ? cands[0].logProb - rival.logProb : Infinity,
      rival: rival ? { id: rival.id, text: (rival.text || "").trim() } : undefined,
    });
  });

  // Shapes this formula committed to somewhere. A step with no same-side rival in the
  // top-k counts as attested too — the alternatives were not even close.
  const attested = new Set<string>();
  for (const s of slots) if (s.margin >= DELIM_AMBIGUOUS_MARGIN) attested.add(s.shape);

  const fixes = new Map<number, number>();
  const flags: DelimiterFlag[] = [];
  for (const s of slots) {
    if (s.margin >= DELIM_AMBIGUOUS_MARGIN || !s.rival) continue;
    if (!attested.has(s.shape) && attested.has(s.rival.text)) {
      fixes.set(s.index, s.rival.id);
    } else {
      // Either both shapes are really present in this formula, or neither is
      // confidently present. Both cases are unresolvable from the text alone.
      flags.push({ index: s.index, from: s.shape, to: s.rival.text, margin: s.margin });
    }
  }

  const issues: RepairIssue[] = [];
  if (fixes.size > 0) {
    issues.push({
      rule: "delimiter-shape",
      label: `Corrected ${fixes.size} delimiter${fixes.size > 1 ? "s" : ""} read as the wrong bracket`,
      count: fixes.size,
    });
  }
  if (flags.length > 0) {
    const shown = flags.slice(0, 4).map((f) => `${f.from}→${f.to}?`).join(" ");
    issues.push({
      rule: "delimiter-uncertain",
      label: `${flags.length} delimiter${flags.length > 1 ? "s were" : " was"} a close call between shapes (${shown}${flags.length > 4 ? " …" : ""}) — verify against the image`,
      count: flags.length,
    });
  }
  return { fixes, flags, issues };
}
