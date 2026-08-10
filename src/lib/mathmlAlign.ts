/**
 * Make Temml's MathML output portable — correct outside this app, not just in it.
 *
 * Two things Temml leaves implicit, both of which only bite once the markup is
 * exported:
 *
 *  1. **Column alignment** is encoded as CSS classes (`tml-left`, `tml-right`)
 *     instead of the standard `columnalign` attribute. In-app that renders fine
 *     because Temml's stylesheet is loaded, but every other consumer (Word,
 *     LibreOffice, a browser given bare MathML, our own `.mml`/HTML/ZIP export)
 *     sees no alignment information and falls back to the MathML default of
 *     centred. That is exactly why `\begin{array}{ll}` came out centred once it
 *     left the app. Fix: restate the classes as `columnalign`, which is
 *     presentation MathML's own mechanism and needs no external CSS. The classes
 *     stay in place so Temml's stylesheet keeps working in-app.
 *
 *  2. **The MathML namespace** is omitted from `<math>`. HTML5's parser implies
 *     it, so inline usage works — but a standalone `.mml` served as
 *     `application/mathml+xml` is parsed as XML, where nothing is implied and the
 *     elements are unrecognised. Fix: declare `xmlns` explicitly, which is also
 *     valid inline and therefore safe to add unconditionally.
 */

const MATHML_NS = "http://www.w3.org/1998/Math/MathML";

/** mtable/mtr/mtd open+close tags. Attributes are captured for rewriting. */
const TAG_RE = /<(\/?)(mtable|mtr|mlabeledtr|mtd)\b([^>]*)>/g;

type Align = "left" | "center" | "right";

/** What alignment does this tag's existing markup imply? */
function alignOf(attrs: string): Align {
  if (/columnalign\s*=\s*"\s*left/.test(attrs)) return "left";
  if (/columnalign\s*=\s*"\s*right/.test(attrs)) return "right";
  if (/columnalign\s*=\s*"\s*center/.test(attrs)) return "center";
  if (/\btml-left\b/.test(attrs)) return "left";
  if (/\btml-right\b/.test(attrs)) return "right";
  const m = /text-align\s*:\s*(left|right|center)/.exec(attrs);
  if (m) return m[1] as Align;
  return "center";
}

function hasColumnAlign(attrs: string): boolean {
  return /\bcolumnalign\s*=/.test(attrs);
}

/** A tag written `<mtd/>` never gets a matching close tag. */
function selfClosing(attrs: string): boolean {
  return attrs.trimEnd().endsWith("/");
}

/**
 * Per-column alignment for one table. Rows can disagree (a `cases` label column
 * versus its body), so take the most common value per column and let deviating
 * cells carry their own attribute.
 */
function columnSpec(rows: Align[][]): Align[] {
  const cols = rows.reduce((n, r) => Math.max(n, r.length), 0);
  const spec: Align[] = [];
  for (let i = 0; i < cols; i++) {
    const tally = new Map<Align, number>();
    for (const r of rows) {
      if (i >= r.length) continue;
      tally.set(r[i], (tally.get(r[i]) || 0) + 1);
    }
    let best: Align = "center";
    let bestN = -1;
    for (const [a, n] of tally) {
      if (n > bestN) {
        best = a;
        bestN = n;
      }
    }
    spec.push(best);
  }
  return spec;
}

function insertAttr(slash: string, tag: string, attrs: string, value: string): string {
  // Preserve a self-closing slash by inserting before it.
  const trimmed = attrs.trimEnd();
  if (trimmed.endsWith("/")) {
    return `<${slash}${tag}${trimmed.slice(0, -1)} columnalign="${value}"/>`;
  }
  return `<${slash}${tag}${attrs} columnalign="${value}">`;
}

/** Declare the MathML namespace on every `<math>` that lacks it. */
function addNamespace(mathml: string): string {
  return mathml.replace(/<math\b([^>]*)>/g, (full, attrs: string) => {
    if (/\bxmlns\s*=/.test(attrs)) return full;
    const trimmed = attrs.trimEnd();
    if (trimmed.endsWith("/")) return `<math${trimmed.slice(0, -1)} xmlns="${MATHML_NS}"/>`;
    return `<math${attrs} xmlns="${MATHML_NS}">`;
  });
}

export function normalizeMathmlAlignment(mathml: string): string {
  if (!mathml) return mathml;
  if (!mathml.includes("<mtable")) return addNamespace(mathml);
  return addNamespace(alignTables(mathml));
}

function alignTables(mathml: string): string {

  // Pass 1 — walk the tag stream and work out each table's column spec. Keyed by
  // the mtable's offset so pass 2 can look it up when it reaches that same tag.
  const specs = new Map<number, Align[]>();
  {
    const stack: { start: number; rows: Align[][] }[] = [];
    TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TAG_RE.exec(mathml)) !== null) {
      const [, slash, tag, attrs] = m;
      if (slash) {
        if (tag === "mtable") {
          const t = stack.pop();
          if (t) specs.set(t.start, columnSpec(t.rows));
        }
        continue;
      }
      if (tag === "mtable") {
        if (selfClosing(attrs)) continue;
        stack.push({ start: m.index, rows: [] });
      } else if (tag === "mtr" || tag === "mlabeledtr") {
        stack[stack.length - 1]?.rows.push([]);
      } else {
        const t = stack[stack.length - 1];
        if (!t) continue;
        if (!t.rows.length) t.rows.push([]);
        t.rows[t.rows.length - 1].push(alignOf(attrs));
      }
    }
    // Unclosed tables still deserve whatever we managed to read.
    while (stack.length) {
      const t = stack.pop()!;
      specs.set(t.start, columnSpec(t.rows));
    }
  }

  // Pass 2 — rewrite. `replace` visits matches left to right, so the same stack
  // walk can run inline and tell each cell which column it is in.
  const stack: { spec: Align[]; col: number }[] = [];
  TAG_RE.lastIndex = 0;
  return mathml.replace(TAG_RE, (full, slash: string, tag: string, attrs: string, offset: number) => {
    if (slash) {
      if (tag === "mtable") stack.pop();
      return full;
    }

    if (tag === "mtable") {
      const spec = specs.get(offset) || [];
      if (!selfClosing(attrs)) stack.push({ spec, col: 0 });
      if (hasColumnAlign(attrs) || spec.length === 0) return full;
      return insertAttr(slash, tag, attrs, spec.join(" "));
    }

    if (tag === "mtr" || tag === "mlabeledtr") {
      const t = stack[stack.length - 1];
      if (t) t.col = 0;
      return full;
    }

    // mtd — only annotate when it disagrees with its column, so the markup stays
    // as small as the information requires.
    const t = stack[stack.length - 1];
    if (!t || hasColumnAlign(attrs)) return full;
    const col = t.col++;
    const mine = alignOf(attrs);
    const table = t.spec[col] ?? "center";
    if (mine === table) return full;
    return insertAttr(slash, tag, attrs, mine);
  });
}
