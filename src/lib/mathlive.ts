// Lazy loader for MathLive, the engine behind the MathType-style visual editor.
//
// MathLive is ~840 kB minified, which is a lot to pay for on first paint when most
// sessions never open the editor. So it is imported on demand and the promise is
// memoised: the first caller pays, everyone after gets the resolved module.
//
// Fonts: MathLive renders with the *same* font families as KaTeX — KaTeX_Main,
// KaTeX_Math, KaTeX_Size1..4 and friends, byte-identical files under a different
// package. index.html already pulls katex.min.css from the CDN, which declares every
// one of those @font-face rules, so `fontsDirectory = null` tells MathLive not to
// inject a second, duplicate set. That keeps the single-file build genuinely single:
// no relative /fonts directory that would 404 when the HTML is opened from disk.

import type { MathfieldElement } from "mathlive";

let modPromise: Promise<typeof import("mathlive")> | null = null;

export function loadMathLive(): Promise<typeof import("mathlive")> {
  if (!modPromise) {
    modPromise = import("mathlive").then((mod) => {
      const El = mod.MathfieldElement;
      // See the note above: KaTeX's CSS already registered these families.
      El.fontsDirectory = null;
      // No sound files ship with the bundle, and silently 404ing on every keystroke
      // is worse than typing quietly.
      El.soundsDirectory = null;
      El.keypressVibration = false;
      return mod;
    });
  }
  return modPromise;
}

/** The concrete element type, re-exported so components need not import from mathlive. */
export type MathField = MathfieldElement;

/**
 * Rewrite MathLive's `\displaylines{…}` into a standard `gathered` environment.
 *
 * When a mathfield holds top-level row breaks, MathLive serialises the whole value as
 * `\displaylines{a \\ b}`. That is valid plain TeX, but it is a Knuth-era primitive that
 * neither KaTeX nor temml implements — so the preview rendered it as red error text, the
 * MathML export dropped it, and a saved `.tex` would only compile under plain TeX. Worse,
 * because nothing downstream understood the wrapper, the rows were treated as one line,
 * which is exactly the "new line became a single line" symptom.
 *
 * `gathered` is the portable equivalent: every renderer here supports it, each row is
 * centred as its own line, and MathLive itself round-trips it. So the value is normalised
 * on the way out of the mathfield and the rest of the app never sees `\displaylines`.
 *
 * Brace matching rather than a regex, since a formula routinely contains nested `{}`
 * (`\frac{1}{2}`) and `[^}]*` would stop at the first inner close.
 */
export function normalizeDisplaylines(tex: string): string {
  const TOKEN = "\\displaylines";
  let out = tex;

  for (let guard = 0; guard < 32; guard++) {
    const at = out.indexOf(TOKEN);
    if (at === -1) break;

    // Find the `{` that opens the argument, allowing whitespace after the command.
    let open = at + TOKEN.length;
    while (open < out.length && /\s/.test(out[open])) open++;
    if (out[open] !== "{") {
      // No argument to lift — drop the bare command so it cannot reach a renderer.
      out = out.slice(0, at) + out.slice(at + TOKEN.length);
      continue;
    }

    let depth = 0;
    let close = -1;
    for (let i = open; i < out.length; i++) {
      const ch = out[i];
      if (ch === "\\") { i++; continue; } // skip escaped braces
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { close = i; break; }
      }
    }
    if (close === -1) break; // unbalanced; leave the rest alone

    const body = out.slice(open + 1, close);
    out = out.slice(0, at) + wrapGathered(body) + out.slice(close + 1);
  }

  return out;
}

/**
 * Split on the `\\` row breaks that belong to *this* level only.
 *
 * A plain `split(/\\\\/)` also cuts the row breaks inside a nested environment, so
 * `\begin{cases}a\\b\end{cases} \\ z` came apart into three pieces instead of two. Rejoining
 * them at the top level turns one line holding a `cases` into two `gathered` rows — the
 * nested structure is still there, but it is no longer on the line the user put it on.
 * `\substack{x\\y}` has the same problem one brace deeper.
 *
 * So a break counts only at brace depth zero and outside any `\begin…\end` pair.
 */
function splitTopLevelRows(body: string): string[] {
  const rows: string[] = [];
  let start = 0;
  let braces = 0;
  let envs = 0;

  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "\\") {
      if (body[i] === "{") braces++;
      else if (body[i] === "}") braces--;
      continue;
    }
    // At a backslash: read the command name to spot \begin, \end and \\.
    if (body[i + 1] === "\\") {
      if (braces === 0 && envs === 0) {
        rows.push(body.slice(start, i));
        start = i + 2;
      }
      i++; // consume the second backslash either way
      continue;
    }
    const name = /^\\([a-zA-Z]+)/.exec(body.slice(i));
    if (name?.[1] === "begin") envs++;
    else if (name?.[1] === "end") envs--;
    // Skip the whole command, so an escaped brace like `\{` never moves the depth.
    i += name ? name[0].length - 1 : 1;
  }
  rows.push(body.slice(start));
  return rows;
}

/**
 * Wrap rows in `gathered`, or return them bare when there is only one.
 *
 * A single row needs no environment, and adding one would centre a formula the user never
 * asked to centre. Trailing empty rows are dropped: pressing Enter at the end of the last
 * line is how people finish typing, and it should not leave a blank row behind.
 */
function wrapGathered(body: string): string {
  const rows = splitTopLevelRows(body).map((r) => r.trim());

  while (rows.length && rows[rows.length - 1] === "") rows.pop();
  if (rows.length === 0) return "";
  if (rows.length === 1) return rows[0];
  return "\\begin{gathered}" + rows.join(" \\\\ ") + "\\end{gathered}";
}

/**
 * Read a mathfield's LaTeX in the form the rest of the app expects.
 *
 * Every read of `mf.value` goes through here so no `\displaylines` can leak into state,
 * the LaTeX pane, an export, or a file on disk.
 */
export function readMathfield(mf: MathField): string {
  return normalizeDisplaylines(mf.value);
}

/** The LaTeX of whatever is selected, or "" when the selection is only a caret. */
export function selectionLatex(mf: MathField): string {
  try {
    const s = mf.getValue(mf.selection, "latex");
    return typeof s === "string" ? s.trim() : "";
  } catch {
    // `selection` is meaningless until the field is mounted and focused.
    return "";
  }
}

/**
 * Put `value` in the template's first hole.
 *
 * Braced when it is more than a single token, because a hole is not always already inside
 * braces — `^{#?}` is, but the trailing `#?` of `\sum_{#?}^{#?}#?` is not, and
 * `\sum...a+b` would bind only the `a`. A redundant group is harmless: MathLive drops it
 * when it re-serialises the field.
 */
function fillFirstHole(tex: string, value: string): string {
  const at = tex.indexOf("#?");
  if (at === -1) return tex;
  const body = /^(\\[a-zA-Z]+|.)$/.test(value) ? value : `{${value}}`;
  return tex.slice(0, at) + body + tex.slice(at + 2);
}

/**
 * Insert LaTeX at the caret, honouring MathType's placeholder convention.
 *
 * Templates in the palettes are written with `#?`, MathLive's placeholder token. After
 * insertion the caret lands on the first hole and Tab walks the rest — which is the
 * whole difference between a template and a text snippet.
 *
 * A selection is treated as the template's subject rather than as something in the way.
 * Select the `2` of `a2` and click superscript and you get `a^2`; select `x+1` and click
 * the square root and you get `\sqrt{x+1}`. Replacing the selection instead — which is
 * what a plain insert does — throws away the very thing the user pointed at, and is the
 * reason `\placeholder{}` kept turning up where a symbol was expected. Templates with no
 * hole (a bare `\times`) still replace, because for those there is nothing to wrap and
 * replacing is what the gesture means.
 */
export function insertTemplate(mf: MathField, tex: string): void {
  const selected = selectionLatex(mf);
  const body = selected ? fillFirstHole(tex, selected) : tex;
  mf.insert(body, {
    focus: true,
    feedback: false,
    format: "latex",
    mode: "math",
    insertionMode: "replaceSelection",
    selectionMode: body.includes("#?") ? "placeholder" : "after",
    scrollIntoView: true,
  });
  mf.focus();
}

/**
 * Build a matrix body of `#?` cells.
 *
 * `env` is a LaTeX environment name, so the fence is chosen by the caller — `matrix` for
 * a bare grid, `pmatrix` / `bmatrix` / … when it should be delimited.
 */
export function matrixTemplate(rows: number, cols: number, env: string): string {
  const r = Math.max(1, Math.min(20, rows));
  const c = Math.max(1, Math.min(20, cols));
  const line = Array(c).fill("#?").join(" & ");
  return `\\begin{${env}}${Array(r).fill(line).join(" \\\\ ")}\\end{${env}}`;
}
