/**
 * Presentation-MathML → LaTeX conversion.
 *
 * Used by the LaTeX Tool so a user can paste MathML straight into the editor and
 * keep working in LaTeX. Two strategies, in order of fidelity:
 *
 *  1. `<annotation encoding="application/x-tex">` — MathML produced by KaTeX,
 *     MathJax, Word, and our own exporters usually carries the original LaTeX
 *     verbatim. When present it is exact, so it always wins.
 *  2. Structural walk of the presentation tree. Lossier by nature (MathML
 *     encodes layout, LaTeX encodes intent) but handles hand-written and
 *     third-party MathML that has no annotation.
 */

/** Unicode operators/letters that have a canonical LaTeX command. */
const CHAR_MAP: Record<string, string> = {
  "⁡": "", // function application — invisible, no LaTeX equivalent
  "⁢": "", // invisible times
  "⁣": "", // invisible separator
  "⁤": "",
  " ": " ",
  "−": "-",
  "′": "'",
  "±": "\\pm",
  "∓": "\\mp",
  "×": "\\times",
  "÷": "\\div",
  "⋅": "\\cdot",
  "∘": "\\circ",
  "∗": "\\ast",
  "≤": "\\leq",
  "≥": "\\geq",
  "≠": "\\neq",
  "≈": "\\approx",
  "≡": "\\equiv",
  "∼": "\\sim",
  "≅": "\\cong",
  "∝": "\\propto",
  "≪": "\\ll",
  "≫": "\\gg",
  "∈": "\\in",
  "∉": "\\notin",
  "∋": "\\ni",
  "⊂": "\\subset",
  "⊃": "\\supset",
  "⊆": "\\subseteq",
  "⊇": "\\supseteq",
  "∪": "\\cup",
  "∩": "\\cap",
  "∅": "\\emptyset",
  "∀": "\\forall",
  "∃": "\\exists",
  "∄": "\\nexists",
  "¬": "\\neg",
  "∧": "\\wedge",
  "∨": "\\vee",
  "→": "\\to",
  "←": "\\leftarrow",
  "↔": "\\leftrightarrow",
  "⇒": "\\Rightarrow",
  "⇐": "\\Leftarrow",
  "⇔": "\\Leftrightarrow",
  "↦": "\\mapsto",
  "∞": "\\infty",
  "∂": "\\partial",
  "∇": "\\nabla",
  "√": "\\sqrt",
  "∑": "\\sum",
  "∏": "\\prod",
  "∫": "\\int",
  "∬": "\\iint",
  "∭": "\\iiint",
  "∮": "\\oint",
  "∴": "\\therefore",
  "∵": "\\because",
  "∣": "|", // U+2223 DIVIDES — what MathML uses for a plain bar; `|` covers both
  "∤": "\\nmid",
  "∥": "\\parallel",
  "⊥": "\\perp",
  "∠": "\\angle",
  "°": "^\\circ",
  "…": "\\dots",
  "⋯": "\\cdots",
  "⋮": "\\vdots",
  "⋱": "\\ddots",
  "ℵ": "\\aleph",
  "ℜ": "\\Re",
  "ℑ": "\\Im",
  "℘": "\\wp",
  "ℓ": "\\ell",
  "ℏ": "\\hbar",
  "≂": "\\eqsim",
  "≺": "\\prec",
  "≻": "\\succ",
  "⊕": "\\oplus",
  "⊗": "\\otimes",
  "⊙": "\\odot",
  "ℷ": "\\beth",
  // Greek lower
  "α": "\\alpha", "β": "\\beta", "γ": "\\gamma", "δ": "\\delta",
  "ε": "\\varepsilon", "ϵ": "\\epsilon", "ζ": "\\zeta", "η": "\\eta",
  "θ": "\\theta", "ϑ": "\\vartheta", "ι": "\\iota", "κ": "\\kappa",
  "λ": "\\lambda", "μ": "\\mu", "ν": "\\nu", "ξ": "\\xi",
  "π": "\\pi", "ϖ": "\\varpi", "ρ": "\\rho", "ϱ": "\\varrho",
  "σ": "\\sigma", "ς": "\\varsigma", "τ": "\\tau", "υ": "\\upsilon",
  "φ": "\\varphi", "ϕ": "\\phi", "χ": "\\chi", "ψ": "\\psi",
  "ω": "\\omega",
  // Greek upper
  "Γ": "\\Gamma", "Δ": "\\Delta", "Θ": "\\Theta", "Λ": "\\Lambda",
  "Ξ": "\\Xi", "Π": "\\Pi", "Σ": "\\Sigma", "Υ": "\\Upsilon",
  "Φ": "\\Phi", "Ψ": "\\Psi", "Ω": "\\Omega",
};

/** Multi-letter names that are operators, not variables. */
const FUNCTIONS = new Set([
  "sin", "cos", "tan", "cot", "sec", "csc",
  "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "coth",
  "log", "ln", "lg", "exp", "min", "max", "sup", "inf", "lim", "limsup", "liminf",
  "det", "dim", "ker", "deg", "gcd", "hom", "arg", "Pr",
]);

/** LaTeX names for the stretchy delimiters that appear in <mfenced>/<mo>. */
const DELIM_MAP: Record<string, string> = {
  "(": "(", ")": ")", "[": "[", "]": "]",
  "{": "\\{", "}": "\\}",
  "|": "|", "∣": "|", "‖": "\\|", "∥": "\\|",
  "⌈": "\\lceil", "⌉": "\\rceil",
  "⌊": "\\lfloor", "⌋": "\\rfloor",
  "⟨": "\\langle", "⟩": "\\rangle",
};

const ACCENT_MAP: Record<string, string> = {
  "ˆ": "\\hat", "^": "\\hat",
  "˜": "\\tilde", "~": "\\tilde",
  "¯": "\\bar", "‾": "\\overline",
  "→": "\\vec", "⃗": "\\vec",
  "˙": "\\dot", "¨": "\\ddot",
  "ˇ": "\\check", "˘": "\\breve",
  "´": "\\acute", "`": "\\grave",
  "⏞": "\\overbrace", "⏟": "\\underbrace",
};

const VARIANT_MAP: Record<string, string> = {
  bold: "\\mathbf",
  italic: "",
  "bold-italic": "\\boldsymbol",
  "double-struck": "\\mathbb",
  fraktur: "\\mathfrak",
  script: "\\mathcal",
  "sans-serif": "\\mathsf",
  monospace: "\\mathtt",
  normal: "\\mathrm",
};

/** Map a run of text through CHAR_MAP, escaping LaTeX specials. */
function mapText(s: string): string {
  let out = "";
  for (const ch of s) {
    if (ch in CHAR_MAP) {
      const rep = CHAR_MAP[ch];
      // Commands need a trailing space so `\alpha x` doesn't become `\alphax`.
      out += rep && /^\\[a-zA-Z]+$/.test(rep) ? rep + " " : rep;
    } else if ("#$%&_{}".includes(ch)) {
      // Braces especially: an <mo>{</mo> copied through verbatim would open a
      // group that never closes and break the whole expression.
      out += "\\" + ch;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Wrap in braces unless it is already a single token or a balanced group. */
function group(s: string): string {
  const t = s.trim();
  if (t === "") return "{}";
  if (t.length === 1) return t;
  if (/^\\[a-zA-Z]+$/.test(t)) return t;
  return "{" + t + "}";
}

function elementChildren(node: Element): Element[] {
  return Array.from(node.children);
}

/** Concatenate the LaTeX of a node list, dropping empties. */
function joinNodes(nodes: Element[]): string {
  return nodes.map(convertNode).filter((s) => s !== "").join(" ").replace(/\s+/g, " ").trim();
}

function localName(el: Element): string {
  return (el.localName || el.nodeName).toLowerCase().replace(/^[a-z0-9]+:/, "");
}

/** <mtable> → array/matrix environment, preserving per-column alignment. */
function convertTable(el: Element): string {
  const rows = elementChildren(el).filter((c) => localName(c) === "mtr" || localName(c) === "mlabeledtr");
  const body = rows
    .map((r) =>
      elementChildren(r)
        .filter((c) => localName(c) === "mtd")
        .map(convertNode)
        .join(" & "),
    )
    .join(" \\\\ ");

  const maxCols = rows.reduce(
    (n, r) => Math.max(n, elementChildren(r).filter((c) => localName(c) === "mtd").length),
    0,
  );

  // columnalign is the whole reason matrices lose their alignment on round-trip,
  // so honour it explicitly instead of defaulting everything to centred.
  const colAlign = (el.getAttribute("columnalign") || "").trim().split(/\s+/).filter(Boolean);
  const letterFor = (a?: string) => (a === "left" ? "l" : a === "right" ? "r" : "c");
  let spec: string;
  if (colAlign.length === 0) {
    spec = "c".repeat(maxCols || 1);
  } else if (colAlign.length === 1) {
    spec = letterFor(colAlign[0]).repeat(maxCols || 1);
  } else {
    spec = Array.from({ length: maxCols || 1 }, (_, i) => letterFor(colAlign[i] ?? colAlign[colAlign.length - 1])).join("");
  }

  return `\\begin{array}{${spec}} ${body} \\end{array}`;
}

const OPEN_FENCE = /^[([{|∣⌈⌊⟨‖∥]$/;
const CLOSE_FENCE = /^[)\]}|∣⌉⌋⟩‖∥]$/;

function isFence(el: Element | undefined, re: RegExp): boolean {
  if (!el || localName(el) !== "mo") return false;
  const t = (el.textContent || "").trim();
  return t in DELIM_MAP && re.test(t) && el.getAttribute("stretchy") !== "false";
}

/**
 * `<mrow>(<mo>fence</mo> … <mo>fence</mo>)` is how MathML writes \left…\right.
 * Detect that shape so we emit real scaling delimiters.
 *
 * A single unpaired fence matters just as much: `\left\{ … \right.` (the shape
 * `cases` compiles to) arrives as one opening `<mo>{</mo>` and nothing closing
 * it. Escaping that to a literal `\{` renders, but a bare `{` — which is what an
 * unescaped pass-through gives — opens a group that never closes and destroys
 * the rest of the expression. Either way the brace must be paired with a null
 * `\right.` to keep the delimiter stretchy.
 */
function convertRow(el: Element): string {
  const kids = elementChildren(el);
  if (kids.length >= 2) {
    const first = kids[0];
    const last = kids[kids.length - 1];
    const openOk = isFence(first, OPEN_FENCE);
    const closeOk = isFence(last, CLOSE_FENCE);
    if (openOk && closeOk) {
      const open = (first.textContent || "").trim();
      const close = (last.textContent || "").trim();
      const inner = joinNodes(kids.slice(1, -1));
      return `\\left${DELIM_MAP[open]} ${inner} \\right${DELIM_MAP[close]}`;
    }
    if (openOk) {
      const open = (first.textContent || "").trim();
      const inner = joinNodes(kids.slice(1));
      return `\\left${DELIM_MAP[open]} ${inner} \\right.`;
    }
    if (closeOk) {
      const close = (last.textContent || "").trim();
      const inner = joinNodes(kids.slice(0, -1));
      return `\\left. ${inner} \\right${DELIM_MAP[close]}`;
    }
  }
  return joinNodes(kids);
}

function convertNode(node: Element): string {
  const tag = localName(node);
  const kids = elementChildren(node);

  switch (tag) {
    case "math":
    case "semantics":
    case "mstyle":
    case "mpadded":
    case "mphantom":
      return joinNodes(kids);

    case "mrow":
      return convertRow(node);

    case "mi": {
      const raw = (node.textContent || "").trim();
      const variant = node.getAttribute("mathvariant");
      if (FUNCTIONS.has(raw)) return "\\" + raw;
      const t = mapText(raw);
      // Multi-letter identifiers are upright words in MathML, italic runs in LaTeX.
      const base = raw.length > 1 && /^[A-Za-z]+$/.test(raw) ? `\\mathrm{${raw}}` : t;
      // mathvariant="normal" wraps the *input*, not the output — so when the input
      // already mapped to a command like \infty, mathrm would break it.
      if (variant && VARIANT_MAP[variant] && variant !== "normal") {
        const cmd = VARIANT_MAP[variant];
        return cmd ? `${cmd}{${raw.length > 1 ? raw : t}}` : t;
      }
      return base;
    }

    case "mn":
      return mapText((node.textContent || "").trim());

    case "mo": {
      const raw = (node.textContent || "").trim();
      if (raw === "") return "";
      const mapped = mapText(raw);
      // A lone \sqrt from <mo>√</mo> would swallow the next token; keep it literal.
      return mapped.trim() === "\\sqrt" ? "\\surd" : mapped;
    }

    case "mtext": {
      const raw = node.textContent || "";
      if (raw.trim() === "") return raw.length ? "\\ " : "";
      return `\\text{${raw.replace(/([{}\\])/g, "\\$1")}}`;
    }

    case "ms":
      return `\\text{"${(node.textContent || "").replace(/([{}\\])/g, "\\$1")}"}`;

    case "mspace": {
      const w = node.getAttribute("width") || "";
      if (/^0/.test(w)) return "";
      const em = parseFloat(w);
      if (!Number.isNaN(em)) {
        if (em >= 1) return "\\quad";
        if (em >= 0.27) return "\\;";
        if (em >= 0.2) return "\\:";
        return "\\,";
      }
      return "\\ ";
    }

    case "mfrac": {
      const [num, den] = kids;
      const n = num ? convertNode(num) : "";
      const d = den ? convertNode(den) : "";
      if (node.getAttribute("linethickness") === "0") return `\\binom{${n}}{${d}}`;
      return `\\frac{${n}}{${d}}`;
    }

    case "msqrt":
      return `\\sqrt{${joinNodes(kids)}}`;

    case "mroot": {
      const [base, idx] = kids;
      return `\\sqrt[${idx ? convertNode(idx) : ""}]{${base ? convertNode(base) : ""}}`;
    }

    case "msup": {
      const [b, s] = kids;
      return `${group(b ? convertNode(b) : "")}^${group(s ? convertNode(s) : "")}`;
    }

    case "msub": {
      const [b, s] = kids;
      return `${group(b ? convertNode(b) : "")}_${group(s ? convertNode(s) : "")}`;
    }

    case "msubsup": {
      const [b, sub, sup] = kids;
      return `${group(b ? convertNode(b) : "")}_${group(sub ? convertNode(sub) : "")}^${group(sup ? convertNode(sup) : "")}`;
    }

    case "munder": {
      const [b, u] = kids;
      const base = b ? convertNode(b) : "";
      const under = u ? convertNode(u) : "";
      const acc = (u?.textContent || "").trim();
      if (acc === "⏟") return `\\underbrace{${base}}`;
      // Large operators take real limits; anything else needs \underset.
      if (/^\\(sum|prod|int|oint|lim|max|min|sup|inf|bigcup|bigcap)$/.test(base.trim())) return `${base}_{${under}}`;
      return `\\underset{${under}}{${base}}`;
    }

    case "mover": {
      const [b, o] = kids;
      const base = b ? convertNode(b) : "";
      const acc = (o?.textContent || "").trim();
      if (o && (o.getAttribute("accent") === "true" || acc in ACCENT_MAP)) {
        const cmd = ACCENT_MAP[acc];
        if (cmd) return `${cmd}{${base}}`;
      }
      const over = o ? convertNode(o) : "";
      if (/^\\(sum|prod|int|oint|lim|max|min|sup|inf|bigcup|bigcap)$/.test(base.trim())) return `${base}^{${over}}`;
      return `\\overset{${over}}{${base}}`;
    }

    case "munderover": {
      const [b, u, o] = kids;
      const base = b ? convertNode(b) : "";
      return `${base}_{${u ? convertNode(u) : ""}}^{${o ? convertNode(o) : ""}}`;
    }

    case "mfenced": {
      // Deprecated but still emitted by Word and older tools.
      const open = node.getAttribute("open") ?? "(";
      const close = node.getAttribute("close") ?? ")";
      const sep = node.getAttribute("separators") ?? ",";
      const inner = kids.map(convertNode).join(sep.trim() ? sep.trim()[0] + " " : " ");
      const o = DELIM_MAP[open] ?? (open === "" ? "." : open);
      const c = DELIM_MAP[close] ?? (close === "" ? "." : close);
      return `\\left${o} ${inner} \\right${c}`;
    }

    case "mtable":
      return convertTable(node);

    case "mtr":
    case "mlabeledtr":
      return elementChildren(node).map(convertNode).join(" & ");

    case "mtd":
      return joinNodes(kids);

    case "menclose": {
      const notation = node.getAttribute("notation") || "longdiv";
      const inner = joinNodes(kids);
      if (notation.includes("box")) return `\\boxed{${inner}}`;
      if (notation.includes("top")) return `\\overline{${inner}}`;
      if (notation.includes("bottom")) return `\\underline{${inner}}`;
      return inner;
    }

    case "annotation":
    case "annotation-xml":
      return ""; // handled by the fast path, never part of the visual tree

    default:
      return joinNodes(kids) || mapText((node.textContent || "").trim());
  }
}

/** Tidy artefacts of node-by-node joining. */
function cleanup(tex: string): string {
  return tex
    .replace(/\s+/g, " ")
    .replace(/\s*([_^])\s*/g, "$1")
    .replace(/\{\s+/g, "{")
    .replace(/\s+\}/g, "}")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+,/g, ",")
    .replace(/\\left\s+/g, "\\left")
    .replace(/\\right\s+/g, "\\right")
    .replace(/ +/g, " ")
    .trim();
}

/** Heuristic: does this string look like MathML rather than LaTeX? */
export function looksLikeMathml(s: string): boolean {
  const t = s.trim();
  if (!t.startsWith("<")) return false;
  return /<\s*(math|mrow|mi|mn|mo|mfrac|msup|msub|msqrt|mtable|semantics)\b/i.test(t);
}

/**
 * Convert one or more MathML documents to LaTeX. Multiple sibling `<math>`
 * blocks become one line each, matching the editor's line-per-expression model.
 * Returns "" when the input cannot be parsed as MathML.
 */
export function mathmlToLatex(src: string): string {
  const input = src.trim();
  if (!input) return "";

  // Strip XML prologue/wrapper our own .mml export adds.
  const cleaned = input.replace(/<\?xml[^>]*\?>/gi, "").replace(/<\/?mathset>/gi, "").trim();

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(`<root>${cleaned}</root>`, "text/xml");
  } catch {
    return "";
  }
  if (doc.getElementsByTagName("parsererror").length) {
    // Malformed XML — retry through the HTML parser, which is lenient.
    const html = new DOMParser().parseFromString(cleaned, "text/html");
    const maths = Array.from(html.getElementsByTagName("math"));
    if (!maths.length) return "";
    return maths.map(convertOne).filter(Boolean).join("\n");
  }

  const root = doc.documentElement;
  const maths = Array.from(root.getElementsByTagName("*")).filter((el) => localName(el) === "math");
  if (maths.length) {
    // Only top-level <math> — nested ones are already covered by their parent.
    const top = maths.filter((m) => !maths.some((o) => o !== m && o.contains(m)));
    return top.map(convertOne).filter(Boolean).join("\n");
  }

  // A bare fragment such as `<mfrac>…</mfrac>` with no <math> wrapper.
  return cleanup(joinNodes(elementChildren(root)));
}

function convertOne(math: Element): string {
  // Fast path: the original LaTeX is usually right there in the annotation.
  const annotations = Array.from(math.getElementsByTagName("*")).filter((el) => localName(el) === "annotation");
  for (const a of annotations) {
    const enc = (a.getAttribute("encoding") || "").toLowerCase();
    if (enc.includes("tex") && !enc.includes("xml")) {
      const tex = (a.textContent || "").trim();
      if (tex) return tex;
    }
  }
  return cleanup(convertNode(math));
}
