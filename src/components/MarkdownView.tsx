import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MathView } from "./MathView";
import { copyText, download } from "@/lib/utils";
import { highlight, TOKEN_CLASS } from "@/lib/highlight";
import { IconCheck, IconCopy, IconDownload } from "./icons";

/**
 * The chat answer renderer.
 *
 * This is a hand-written Markdown subset rather than `react-markdown` +
 * `remark-gfm` + `rehype-katex`, for the same reason `lib/highlight` is not
 * Prism: the app ships as one inlined `index.html`, and that plugin chain costs
 * more than the entire rest of the UI. So the parser here covers what models
 * actually emit, and nothing else.
 *
 * What models actually emit, and what each is worth getting right:
 *   · tables — constant in comparisons and "which method should I use" answers,
 *     and the single worst thing to get wrong: a table rendered as a paragraph
 *     of pipes is unreadable, not merely unstyled.
 *   · nested and task lists — proofs and worked steps nest two or three deep.
 *   · maths, inline and display — the whole point of this app.
 *   · links — footnoted sources, which are worthless as bare text.
 *   · fenced code with a language — read by eye, so it gets a real toolbar.
 *
 * Two properties are load-bearing beyond "it looks right":
 *
 * **It runs on every streamed chunk.** A 2 kB answer is re-parsed a hundred
 * times as it arrives, so parsing is a single pass with no backtracking, and the
 * expensive leaves (KaTeX, the tokenizer) are memoised on their own input. It
 * also has to render sensibly *mid-token* — an unclosed fence is a code block
 * that has not finished, not a syntax error.
 *
 * **The text is untrusted.** It is model output, and the model may be repeating
 * an instruction it read inside a user's uploaded PDF. Nothing here reaches
 * `dangerouslySetInnerHTML` (KaTeX does, on maths only, inside `MathView`), and
 * every URL goes through `safeUrl` before it becomes an `href` or a `src`, so a
 * `javascript:` link cannot be smuggled through a footnote.
 */

// ---------------------------------------------------------------------------
// URL safety
// ---------------------------------------------------------------------------

/**
 * The only URLs allowed to become an `href` or a `src`.
 *
 * An allowlist, not a blocklist: `javascript:` is the obvious attack but
 * `vbscript:`, `data:text/html` and `file:` are all equally unwelcome, and new
 * schemes keep being invented. Anything unrecognised returns null and the caller
 * renders the link as plain text — visibly inert, which is the honest outcome.
 */
function safeUrl(raw: string, allowImageData = false): string | null {
  const u = raw.trim().replace(/^<|>$/g, "");
  if (!u || /[\s\u0000-\u001f\u007f]/.test(u)) return null;
  if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u)) return u;
  // Bare hostnames are how models write links in prose ("see www.example.com").
  if (/^www\./i.test(u)) return `https://${u}`;
  // Generated images arrive as data URLs from `lib/imageGen`; other data: is not
  // an image and has no business here.
  if (allowImageData && /^data:image\/[a-z+]+;base64,/i.test(u)) return u;
  return null;
}

// ---------------------------------------------------------------------------
// Inline scanning helpers
// ---------------------------------------------------------------------------

/**
 * `$…$` inline maths, or null when this `$` is just a dollar sign.
 *
 * The rule that matters: the closer is the *first* unescaped `$` after the
 * opener, and it only counts if the character before it is not a space. Without
 * "first", "it costs $5 and $10 for $x$" parses as maths from the 5 to the x and
 * eats the sentence. With it, the first candidate closer (before "10") is
 * space-preceded, the opener is rejected, and the prices render as prices.
 */
function matchDollarMath(src: string, i: number): { tex: string; end: number } | null {
  if (src[i] !== "$" || src[i + 1] === "$") return null;
  const after = src[i + 1];
  if (!after || /[\s$]/.test(after)) return null;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === "\n") return null; // inline maths never spans a line break
    if (c === "\\") { j++; continue; }
    if (c !== "$") continue;
    if (/\s/.test(src[j - 1])) return null;
    const tex = src.slice(i + 1, j);
    return tex.trim() ? { tex, end: j + 1 } : null;
  }
  return null;
}

/** The run of backticks at `i`, or "" — code spans use as many as they need. */
function tickRun(src: string, i: number): string {
  let n = 0;
  while (src[i + n] === "`") n++;
  return "`".repeat(n);
}

/**
 * The matching closer for an emphasis delimiter.
 *
 * Skips over escapes, code spans and maths on the way, so the `*` in
 * `` `a * b` `` and the `_` in `$x_1$` cannot close an emphasis that opened
 * before them. `wordBoundary` is set for `_`, where CommonMark's flanking rule
 * is what stops `snake_case_names` from turning into italics.
 */
function findCloser(src: string, from: number, delim: string, wordBoundary: boolean): number {
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") { i++; continue; }
    if (c === "`") {
      const run = tickRun(src, i);
      const close = src.indexOf(run, i + run.length);
      i = close === -1 ? i + run.length - 1 : close + run.length - 1;
      continue;
    }
    if (c === "$") {
      const m = matchDollarMath(src, i);
      if (m) { i = m.end - 1; continue; }
    }
    if (!src.startsWith(delim, i)) continue;
    if (/\s/.test(src[i - 1] ?? " ")) continue; // "a * b" is not emphasis
    if (wordBoundary && /[A-Za-z0-9]/.test(src[i + delim.length] ?? "")) continue;
    return i;
  }
  return -1;
}

/**
 * `[text](dest "title")` starting at `i`, with balanced brackets on both halves
 * so `[see [1]](url)` and a destination containing `(…)` — Wikipedia's whole URL
 * scheme — survive.
 */
function matchLink(src: string, i: number): { text: string; href: string; title: string; end: number } | null {
  let depth = 0;
  let j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === "\\") { j++; continue; }
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) break; }
    else if (c === "\n" && depth > 0 && src[j + 1] === "\n") return null;
  }
  if (depth !== 0 || j >= src.length || src[j + 1] !== "(") return null;

  let d = 0;
  let k = j + 1;
  for (; k < src.length; k++) {
    const c = src[k];
    if (c === "\\") { k++; continue; }
    if (c === "\n") return null;
    if (c === "(") d++;
    else if (c === ")") { d--; if (d === 0) break; }
  }
  if (d !== 0 || k >= src.length) return null;

  let href = src.slice(j + 2, k).trim();
  let title = "";
  const withTitle = href.match(/^(\S+)\s+["'(]([\s\S]*)["')]$/);
  if (withTitle) { href = withTitle[1]; title = withTitle[2]; }
  return { text: src.slice(i + 1, j), href, title, end: k + 1 };
}

/** Bare URLs in prose. The trailing-punctuation trim keeps "(see https://x.dev)."
 *  from swallowing the bracket and the full stop into the link. */
const BARE_URL = /^(?:https?:\/\/|www\.)[^\s<>[\]()]+(?:\([^\s<>()]*\)[^\s<>[\]()]*)*/;

// ---------------------------------------------------------------------------
// Inline rendering
// ---------------------------------------------------------------------------

const CODE_CHIP =
  "rounded-md border border-white/10 bg-black/30 px-1.5 py-0.5 font-mono text-[0.86em] text-emerald-300";

/**
 * Recursive-descent over one run of text.
 *
 * Recursive rather than the usual single alternation regex because emphasis
 * nests: `**a `code` and *b***` is one bold containing a code span and an
 * italic, and a flat tokenizer renders the inner markers as literal asterisks.
 * `depth` only guards against a pathological input nesting hundreds deep.
 */
function inline(src: string, keyBase: string, depth = 0): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = "";
  let k = 0;

  const flush = () => { if (buf) { out.push(buf); buf = ""; } };
  const push = (node: ReactNode) => { flush(); out.push(node); };
  const key = () => `${keyBase}-${k++}`;

  let i = 0;
  while (i < src.length) {
    const c = src[i];

    // Backslash escapes. `\$` and `\*` are how a model writes a literal dollar
    // or asterisk, and getting this wrong turns the rest of the line into maths.
    if (c === "\\" && /[\\`*_{}[\]()#+\-.!$~|<>]/.test(src[i + 1] ?? "")) {
      buf += src[i + 1];
      i += 2;
      continue;
    }

    // \( … \) — the delimiter every LaTeX-native model reaches for.
    if (c === "\\" && src[i + 1] === "(") {
      const end = src.indexOf("\\)", i + 2);
      if (end !== -1) {
        push(<MathView key={key()} tex={src.slice(i + 2, end)} display={false} />);
        i = end + 2;
        continue;
      }
    }

    // Display maths that a model dropped mid-sentence instead of on its own
    // line. `display:block` on a span keeps it valid inside the <p> it lands in.
    if ((c === "$" && src[i + 1] === "$") || (c === "\\" && src[i + 1] === "[")) {
      const dollar = c === "$";
      const shut = dollar ? "$$" : "\\]";
      const from = i + 2;
      const end = src.indexOf(shut, from);
      if (end !== -1) {
        push(
          <span key={key()} className="block">
            <MathView tex={src.slice(from, end)} display />
          </span>,
        );
        i = end + shut.length;
        continue;
      }
    }

    if (c === "$") {
      const m = matchDollarMath(src, i);
      if (m) {
        push(<MathView key={key()} tex={m.tex} display={false} />);
        i = m.end;
        continue;
      }
    }

    if (c === "`") {
      const run = tickRun(src, i);
      const close = src.indexOf(run, i + run.length);
      if (close !== -1) {
        let code = src.slice(i + run.length, close);
        // ``` `x` ``` — one space each side is padding for the backticks, not content.
        if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) {
          code = code.slice(1, -1);
        }
        push(<code key={key()} className={CODE_CHIP}>{code}</code>);
        i = close + run.length;
        continue;
      }
    }

    if (c === "!" && src[i + 1] === "[") {
      const m = matchLink(src, i + 1);
      const url = m && safeUrl(m.href, true);
      if (m && url) {
        push(
          <img
            key={key()}
            src={url}
            alt={m.text}
            title={m.title || m.text}
            loading="lazy"
            className="my-1 max-h-80 rounded-xl border border-white/10 bg-black/20 object-contain"
          />,
        );
        i = m.end;
        continue;
      }
    }

    if (c === "[") {
      const m = matchLink(src, i);
      if (m) {
        const url = safeUrl(m.href);
        if (url) {
          push(
            <a
              key={key()}
              href={url}
              title={m.title || url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="font-medium text-violet-300 underline decoration-violet-400/40 underline-offset-2 transition hover:decoration-violet-400"
            >
              {inline(m.text, `${keyBase}-l${k}`, depth + 1)}
            </a>,
          );
        } else {
          // A rejected scheme still had text worth reading; show it, inert.
          push(<span key={key()}>{inline(m.text, `${keyBase}-x${k}`, depth + 1)}</span>);
        }
        i = m.end;
        continue;
      }
    }

    // <https://…> autolinks, then bare URLs in running prose.
    if (c === "<") {
      const m = /^<((?:https?:\/\/|mailto:)[^\s>]+)>/.exec(src.slice(i));
      const url = m && safeUrl(m[1]);
      if (m && url) {
        push(<a key={key()} href={url} target="_blank" rel="noopener noreferrer nofollow" className="text-violet-300 underline decoration-violet-400/40 underline-offset-2">{m[1]}</a>);
        i += m[0].length;
        continue;
      }
    }
    if ((c === "h" || c === "w") && !/[A-Za-z0-9@/._-]/.test(src[i - 1] ?? "")) {
      const m = BARE_URL.exec(src.slice(i));
      if (m) {
        const raw = m[0].replace(/[.,;:!?'"]+$/, "");
        const url = safeUrl(raw);
        if (url) {
          push(<a key={key()} href={url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-violet-300 underline decoration-violet-400/40 underline-offset-2">{raw}</a>);
          i += raw.length;
          continue;
        }
      }
    }

    // Emphasis. Longest delimiter first: `**` must be tested before `*`, or
    // every bold opens an italic and closes it on its own second asterisk.
    if (depth < 6) {
      const emph =
        (c === "~" && src[i + 1] === "~" && ["~~", "del"] as const) ||
        ((c === "*" || c === "_") && src[i + 1] === c && [c + c, "strong"] as const) ||
        ((c === "*" || c === "_") && [c, "em"] as const);
      if (emph) {
        const [delim, kind] = emph;
        const word = delim[0] === "_";
        const opensWord = word && /[A-Za-z0-9]/.test(src[i - 1] ?? "");
        const after = src[i + delim.length];
        if (!opensWord && after && !/\s/.test(after)) {
          const close = findCloser(src, i + delim.length, delim, word);
          if (close !== -1) {
            const body = inline(src.slice(i + delim.length, close), `${keyBase}-e${k}`, depth + 1);
            push(
              kind === "strong" ? <strong key={key()} className="font-semibold text-white">{body}</strong>
              : kind === "em" ? <em key={key()} className="italic">{body}</em>
              : <s key={key()} className="opacity-60">{body}</s>,
            );
            i = close + delim.length;
            continue;
          }
        }
      }
    }

    buf += c;
    i++;
  }

  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Block parsing
// ---------------------------------------------------------------------------

type Align = "left" | "center" | "right" | null;
type Item = { checked: boolean | null; blocks: Block[] };

type Block =
  | { type: "code"; lang: string; meta: string; code: string; closed: boolean }
  | { type: "heading"; level: number; text: string }
  | { type: "quote"; blocks: Block[] }
  | { type: "list"; ordered: boolean; start: number; loose: boolean; items: Item[] }
  | { type: "table"; head: string[]; align: Align[]; rows: string[][] }
  | { type: "math"; tex: string }
  | { type: "hr" }
  | { type: "para"; text: string };

const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*(.*)$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const MARKER = /^([ \t]*)(?:([-*+])|(\d{1,9})[.)])([ \t]+|$)(.*)$/;
const MATH_OPEN = /^ {0,3}(\$\$|\\\[)/;
const HR = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;

/**
 * Split one table row into cells.
 *
 * Not `line.split("|")`: a cell may hold `` `a | b` `` or an escaped `\|`, and
 * splitting naively shifts every column after it — which looks like the model
 * produced a broken table when in fact the renderer did.
 */
function splitCells(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && line[i + 1] === "|") { cur += "|"; i++; continue; }
    if (c === "`") {
      const run = tickRun(line, i);
      const close = line.indexOf(run, i + run.length);
      const end = close === -1 ? line.length : close + run.length;
      // `\|` is unescaped even in here. GFM resolves cell boundaries before any
      // inline parsing, so a code span is not a shelter from it — and a cell that
      // renders a stray backslash looks like the model wrote one.
      cur += line.slice(i, end).replace(/\\\|/g, "|");
      i = end - 1;
      continue;
    }
    if (c === "|") { cells.push(cur); cur = ""; continue; }
    cur += c;
  }
  cells.push(cur);
  // Leading and trailing pipes are the table's edges, not empty columns.
  if (cells.length > 1 && !cells[0].trim() && /^\s*\|/.test(line)) cells.shift();
  if (cells.length > 1 && !cells[cells.length - 1].trim() && /\|\s*$/.test(line)) cells.pop();
  return cells.map((s) => s.trim());
}

/** The `|:---|---:|` row, and the column alignments it encodes — or null if this
 *  is not a delimiter row, which is what makes a line a table header at all. */
function delimAligns(line: string, want: number): Align[] | null {
  if (!line.includes("-") || !/^[\s|:-]+$/.test(line)) return null;
  const cells = splitCells(line);
  if (cells.length !== want) return null;
  const out: Align[] = [];
  for (const cell of cells) {
    if (!/^:?-+:?$/.test(cell)) return null;
    const l = cell.startsWith(":");
    const r = cell.endsWith(":");
    out.push(l && r ? "center" : r ? "right" : l ? "left" : null);
  }
  return out;
}

/** Does this line end the paragraph that is being gathered? */
function interrupts(lines: string[], i: number): boolean {
  const line = lines[i];
  if (!line.trim()) return true;
  if (FENCE.test(line) || HEADING.test(line) || HR.test(line)) return true;
  if (QUOTE.test(line) || MARKER.test(line) || MATH_OPEN.test(line)) return true;
  // A pipe row followed by |---| is a table, even mid-paragraph.
  if (line.includes("|") && i + 1 < lines.length) {
    const head = splitCells(line.trim());
    if (head.length > 1 && delimAligns(lines[i + 1].trim(), head.length)) return true;
  }
  return false;
}

const MAX_DEPTH = 5;

function parseList(lines: string[], from: number, depth: number): { block: Block; next: number } {
  const first = lines[from].match(MARKER)!;
  const base = first[1].length;
  const ordered = !!first[3];
  const startNum = ordered ? Math.max(0, parseInt(first[3], 10)) : 1;
  const items: Item[] = [];
  let loose = false;
  let i = from;

  while (i < lines.length) {
    // Blank lines between items make the list *loose* (roomier spacing) rather
    // than ending it — which is the difference between a wide, readable list of
    // paragraphs and two lists jammed together.
    let j = i;
    while (j < lines.length && !lines[j].trim()) j++;
    if (j >= lines.length) break;

    const m = lines[j].match(MARKER);
    if (!m || HR.test(lines[j])) break;
    const indent = m[1].length;
    if (indent < base || indent > base + 3 || !!m[3] !== ordered) break;
    if (j > i) loose = true;
    i = j;

    // Where this item's content column starts. Everything indented to it belongs
    // to the item — that is what makes nesting work at any depth.
    const gap = Math.min(m[4].length || 1, 4);
    const contentAt = indent + (m[2] ? 1 : m[3].length + 1) + gap;
    const buf: string[] = [m[5]];
    let sawBlank = false;
    i++;

    while (i < lines.length) {
      const ln = lines[i];
      if (!ln.trim()) {
        let k = i + 1;
        while (k < lines.length && !lines[k].trim()) k++;
        if (k >= lines.length || lines[k].search(/\S/) < contentAt) break;
        sawBlank = true;
        buf.push("");
        i = k;
        continue;
      }
      const ind = ln.search(/\S/);
      if (ind >= contentAt) { buf.push(ln.slice(contentAt)); i++; continue; }
      // A wrapped line with no indent still belongs to the item it follows —
      // models wrap prose constantly and almost never re-indent it.
      if (sawBlank || interrupts(lines, i)) break;
      buf.push(ln.trim());
      i++;
    }
    if (sawBlank) loose = true;

    const blocks = depth < MAX_DEPTH
      ? parseBlocks(buf.join("\n"), depth + 1)
      : [{ type: "para" as const, text: buf.join("\n") }];

    // `- [x] done` — a checkbox, not a literal bracket pair.
    let checked: boolean | null = null;
    const head = blocks[0];
    if (head && head.type === "para") {
      const task = head.text.match(/^\[([ xX])\][ \t]+([\s\S]*)$/);
      if (task) { checked = task[1] !== " "; head.text = task[2]; }
    }
    items.push({ checked, blocks });
  }

  return { block: { type: "list", ordered, start: startNum, loose, items }, next: i };
}

function parseBlocks(src: string, depth = 0): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // Fenced code. An unclosed fence is the normal state mid-stream, so it ends
    // at the last line rather than being abandoned as malformed.
    const f = line.match(FENCE);
    if (f) {
      const closer = new RegExp(`^ {0,3}${f[2][0] === "`" ? "`" : "~"}{${f[2].length},}[ \\t]*$`);
      const strip = f[1].length;
      const buf: string[] = [];
      let closed = false;
      i++;
      while (i < lines.length) {
        if (closer.test(lines[i])) { closed = true; i++; break; }
        buf.push(strip && !lines[i].slice(0, strip).trim() ? lines[i].slice(strip) : lines[i]);
        i++;
      }
      const info = f[3].trim();
      const [lang = "", ...rest] = info.split(/[\s:]+/);
      blocks.push({ type: "code", lang: lang.toLowerCase(), meta: rest.join(" "), code: buf.join("\n"), closed });
      continue;
    }

    // Display maths gets its own block so it is centred on its own line rather
    // than wedged into a paragraph.
    if (MATH_OPEN.test(line)) {
      const dollar = line.trim().startsWith("$$");
      const open = dollar ? "$$" : "\\[";
      const shut = dollar ? "$$" : "\\]";
      const rest = line.trim().slice(open.length);
      const same = rest.indexOf(shut);
      if (same !== -1) {
        blocks.push({ type: "math", tex: rest.slice(0, same) });
        const tail = rest.slice(same + shut.length).trim();
        i++;
        if (tail) blocks.push({ type: "para", text: tail });
        continue;
      }
      const buf = rest ? [rest] : [];
      i++;
      while (i < lines.length) {
        const at = lines[i].indexOf(shut);
        if (at !== -1) {
          if (lines[i].slice(0, at).trim()) buf.push(lines[i].slice(0, at));
          i++;
          break;
        }
        buf.push(lines[i]);
        i++;
      }
      blocks.push({ type: "math", tex: buf.join("\n") });
      continue;
    }

    // Before lists: `---` and `* * *` match a bullet marker too.
    if (HR.test(line)) { blocks.push({ type: "hr" }); i++; continue; }

    const h = line.match(HEADING);
    if (h) {
      blocks.push({ type: "heading", level: h[1].length, text: (h[2] || "").trim() });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const buf: string[] = [];
      while (i < lines.length) {
        if (QUOTE.test(lines[i])) { buf.push(lines[i].replace(QUOTE, "")); i++; continue; }
        // Lazy continuation: an unprefixed wrapped line still belongs to the quote.
        if (buf.length && lines[i].trim() && !interrupts(lines, i)) { buf.push(lines[i]); i++; continue; }
        break;
      }
      const inner = buf.join("\n");
      blocks.push({
        type: "quote",
        blocks: depth < MAX_DEPTH ? parseBlocks(inner, depth + 1) : [{ type: "para", text: inner }],
      });
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length) {
      const head = splitCells(line.trim());
      const align = head.length > 1 ? delimAligns(lines[i + 1].trim(), head.length) : null;
      if (align) {
        i += 2;
        const rows: string[][] = [];
        while (i < lines.length && lines[i].trim() && lines[i].includes("|") && !FENCE.test(lines[i])) {
          const cells = splitCells(lines[i].trim());
          while (cells.length < head.length) cells.push("");
          rows.push(cells.slice(0, head.length));
          i++;
        }
        blocks.push({ type: "table", head, align, rows });
        continue;
      }
    }

    if (MARKER.test(line)) {
      const { block, next } = parseList(lines, i, depth);
      // A marker that yielded no items would spin the loop forever.
      if (next > i && block.type === "list" && block.items.length) {
        blocks.push(block);
        i = next;
        continue;
      }
    }

    const buf: string[] = [];
    while (i < lines.length && !interrupts(lines, i)) { buf.push(lines[i]); i++; }
    if (buf.length) blocks.push({ type: "para", text: buf.join("\n") });
    else i++; // defensive: never leave `i` unmoved
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Code blocks
// ---------------------------------------------------------------------------

/** Extension for the download button, so a saved snippet opens in the right editor. */
function extForLang(lang: string): string {
  const m: Record<string, string> = {
    js: "js", javascript: "js", jsx: "jsx", ts: "ts", typescript: "ts", tsx: "tsx",
    py: "py", python: "py", java: "java", c: "c", cpp: "cpp", "c++": "cpp", cs: "cs",
    go: "go", rs: "rs", rust: "rs", rb: "rb", ruby: "rb", php: "php", sh: "sh", bash: "sh",
    shell: "sh", zsh: "sh", sql: "sql", html: "html", css: "css", xml: "xml", yaml: "yml",
    yml: "yml", json: "json", tex: "tex", latex: "tex", md: "md", markdown: "md",
    toml: "toml", kt: "kt", kotlin: "kt", swift: "swift", dart: "dart", r: "r",
    jl: "jl", julia: "jl", vue: "vue", svelte: "svelte", ps1: "ps1", powershell: "ps1",
    diff: "diff", patch: "diff", ini: "ini", dockerfile: "Dockerfile", make: "mk",
  };
  return m[(lang || "").toLowerCase()] || (lang || "txt").toLowerCase();
}

/**
 * Colour a fenced block. Memoised on code+language because chat re-renders on
 * every streamed chunk and re-tokenising a 200-line block each time is the one
 * thing here expensive enough to drop frames.
 */
function CodeTokens({ code, lang }: { code: string; lang: string }) {
  const tokens = useMemo(() => highlight(code, lang), [code, lang]);
  return (
    <>
      {tokens.map((t, i) => (
        <span key={i} className={TOKEN_CLASS[t.k]}>{t.v}</span>
      ))}
    </>
  );
}

/** Past this, a block is collapsed on arrival — a 400-line file otherwise buries
 *  the sentence that explains it. */
const COLLAPSE_AT = 24;

const TOOL_BTN =
  "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-slate-400 transition hover:bg-white/10 hover:text-slate-100";

function CodeBlock({ lang, meta, code, closed }: { lang: string; meta: string; code: string; closed: boolean }) {
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const lines = code.split("\n");
  const long = lines.length > COLLAPSE_AT + 4;
  const shown = long && !open ? lines.slice(0, COLLAPSE_AT).join("\n") : code;
  const ext = extForLang(lang);

  return (
    <div className="group/code overflow-hidden rounded-xl border border-white/10 bg-[var(--surface-sunken)] shadow-sm">
      <div className="flex items-center gap-2 border-b border-white/8 bg-white/[0.035] px-3 py-1.5">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {lang || "code"}
        </span>
        {meta && <span className="truncate font-mono text-[10px] text-slate-500">{meta}</span>}
        {/* Streaming: says the block is still arriving, so a half-written
            function does not read as the model's finished answer. */}
        {!closed && <span className="text-[10px] text-amber-300/80">writing…</span>}
        <div className="ml-auto flex items-center gap-0.5">
          {lines.length > 3 && (
            <button onClick={() => setWrap((w) => !w)} className={TOOL_BTN} title={wrap ? "Scroll long lines instead of wrapping" : "Wrap long lines"}>
              {wrap ? "no wrap" : "wrap"}
            </button>
          )}
          <button
            onClick={() => { copyText(code); setCopied(true); }}
            className={TOOL_BTN}
            title="Copy this block"
          >
            {copied ? <IconCheck size={11} /> : <IconCopy size={11} />}
            {copied ? "copied" : "copy"}
          </button>
          <button
            onClick={() => download(`snippet.${ext}`, code)}
            className={`${TOOL_BTN} text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200`}
            title={`Download as .${ext}`}
          >
            <IconDownload size={11} />.{ext}
          </button>
        </div>
      </div>

      <div className="relative">
        <pre className={`overflow-x-auto p-3 text-[12.5px] leading-[1.55] ${wrap ? "whitespace-pre-wrap break-words" : ""}`}>
          <code className="font-mono"><CodeTokens code={shown} lang={lang} /></code>
        </pre>
        {long && !open && (
          <button
            onClick={() => setOpen(true)}
            className="absolute inset-x-0 bottom-0 flex items-end justify-center bg-gradient-to-t from-[var(--surface-sunken)] via-[var(--surface-sunken)]/85 to-transparent pb-2 pt-10 text-[11px] font-medium text-violet-300 hover:text-violet-200"
          >
            Show all {lines.length} lines
          </button>
        )}
      </div>
      {long && open && (
        <button onClick={() => setOpen(false)} className="w-full border-t border-white/8 py-1.5 text-[11px] font-medium text-slate-400 hover:bg-white/5 hover:text-slate-200">
          Collapse
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

const ALIGN_CLASS: Record<string, string> = { left: "text-left", center: "text-center", right: "text-right" };

function MdTable({ head, align, rows, keyBase }: { head: string[]; align: Align[]; rows: string[][]; keyBase: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  // Tab-separated so it pastes into a spreadsheet as columns rather than as one
  // string of pipes — the reason anyone copies a table out of a chat.
  const asTsv = () =>
    [head, ...rows].map((r) => r.map((c) => markdownToPlainText(c).replace(/\s+/g, " ")).join("\t")).join("\n");

  return (
    <div className="group/table relative">
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-white/[0.055]">
              {head.map((cell, c) => (
                <th
                  key={c}
                  className={`whitespace-nowrap border-b border-white/10 px-3 py-2 font-semibold text-white ${ALIGN_CLASS[align[c] ?? "left"]}`}
                >
                  {inline(cell, `${keyBase}-h${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="border-b border-white/[0.06] last:border-0 even:bg-white/[0.02] hover:bg-white/[0.04]">
                {row.map((cell, c) => (
                  <td key={c} className={`px-3 py-1.5 align-top text-slate-200 ${ALIGN_CLASS[align[c] ?? "left"]}`}>
                    {inline(cell, `${keyBase}-r${r}c${c}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        onClick={() => { copyText(asTsv()); setCopied(true); }}
        title="Copy as spreadsheet columns"
        className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-md border border-white/10 bg-[var(--surface-pop)] px-1.5 py-0.5 text-[10px] text-slate-300 opacity-0 transition group-hover/table:opacity-100 hover:text-white"
      >
        {copied ? <IconCheck size={11} /> : <IconCopy size={11} />}
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block rendering
// ---------------------------------------------------------------------------

/** A soft line break inside a paragraph is a line break. CommonMark collapses it
 *  to a space, but models lay out addresses, steps and short lists that way and
 *  expect them to stay on separate lines — every chat UI ships GFM `breaks`. */
function paraNodes(text: string, keyBase: string): ReactNode[] {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  lines.forEach((ln, i) => {
    if (i) out.push(<br key={`${keyBase}-br${i}`} />);
    out.push(...inline(ln, `${keyBase}-${i}`));
  });
  return out;
}

const HEADING_CLASS = [
  "mt-1 border-b border-white/10 pb-1 text-[17px] font-bold tracking-tight text-white",
  "mt-1 border-b border-white/[0.07] pb-1 text-[15.5px] font-bold tracking-tight text-white",
  "mt-0.5 text-[14.5px] font-semibold text-slate-100",
  "text-[13.5px] font-semibold text-slate-100",
  "text-[13px] font-semibold uppercase tracking-wide text-slate-300",
  "text-[12.5px] font-semibold uppercase tracking-wide text-slate-400",
];

/** The streaming caret — a text cursor at the end of what has arrived so far,
 *  which is how every premium chat UI signals "still writing" without a spinner. */
const Caret = () => <span className="mf-caret" aria-hidden="true" />;

function Blocks({ blocks, keyBase, tight = false, caret = false }: {
  blocks: Block[];
  keyBase: string;
  tight?: boolean;
  caret?: boolean;
}) {
  const last = blocks.length - 1;
  const trailingCaret = caret && blocks[last]?.type !== "para";

  return (
    <div className={tight ? "space-y-1.5" : "space-y-3"}>
      {blocks.map((b, i) => {
        const k = `${keyBase}-${i}`;
        const tip = caret && i === last;

        switch (b.type) {
          case "code":
            return <CodeBlock key={k} lang={b.lang} meta={b.meta} code={b.code} closed={b.closed} />;

          case "heading": {
            const Tag = (`h${Math.min(b.level, 6)}`) as "h1";
            return (
              <Tag key={k} className={HEADING_CLASS[b.level - 1]}>
                {inline(b.text, k)}
              </Tag>
            );
          }

          case "quote":
            return (
              <blockquote key={k} className="rounded-r-lg border-l-[3px] border-violet-400/60 bg-violet-500/[0.07] py-2 pl-3.5 pr-3 text-slate-300">
                <Blocks blocks={b.blocks} keyBase={k} tight />
              </blockquote>
            );

          case "hr":
            return <div key={k} className="my-1 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />;

          case "math":
            return <MathView key={k} tex={b.tex} display />;

          case "table":
            return <MdTable key={k} head={b.head} align={b.align} rows={b.rows} keyBase={k} />;

          case "list": {
            const isTask = b.items.some((it) => it.checked !== null);
            const gap = b.loose ? "space-y-2" : "space-y-1";
            const inner = b.items.map((it, j) => {
              const body = <Blocks blocks={it.blocks} keyBase={`${k}-${j}`} tight />;
              if (it.checked === null && isTask) {
                // A plain item inside a checklist: indent it to the same column
                // as the checked ones so the list keeps one left edge.
                return <li key={j} className="pl-[26px]">{body}</li>;
              }
              if (it.checked !== null) {
                return (
                  <li key={j} className="flex items-start gap-2">
                    <span
                      className={
                        "mt-[3px] flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border text-[10px] leading-none " +
                        (it.checked
                          ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-300"
                          : "border-white/20 bg-white/5 text-transparent")
                      }
                      aria-hidden="true"
                    >
                      ✓
                    </span>
                    <span className="sr-only">{it.checked ? "done: " : "to do: "}</span>
                    <div className={"min-w-0 flex-1 " + (it.checked ? "text-slate-400 line-through decoration-slate-500/60" : "")}>
                      {body}
                    </div>
                  </li>
                );
              }
              return <li key={j} className="pl-1">{body}</li>;
            });

            return isTask ? (
              <ul key={k} className={`list-none ${gap}`}>{inner}</ul>
            ) : b.ordered ? (
              <ol key={k} start={b.start} className={`list-decimal pl-6 marker:font-medium marker:text-slate-500 ${gap}`}>{inner}</ol>
            ) : (
              <ul key={k} className={`list-disc pl-5 marker:text-slate-500 ${gap}`}>{inner}</ul>
            );
          }

          default:
            return (
              <p key={k} className="text-slate-200">
                {paraNodes(b.text, k)}
                {tip && <Caret />}
              </p>
            );
        }
      })}
      {trailingCaret && <Caret />}
    </div>
  );
}

export function MarkdownView({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const blocks = useMemo(() => parseBlocks(text || ""), [text]);
  // An empty assistant message that is still streaming shows the caret alone,
  // so the bubble is never blank while the first token is in flight.
  if (!blocks.length) return streaming ? <Caret /> : null;
  return (
    <div className="mf-md min-w-0 text-[14px] leading-[1.7]">
      <Blocks blocks={blocks} keyBase="b" caret={streaming} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

/**
 * The "copy as text" form: what the answer would look like pasted into an email.
 *
 * Structure is preserved rather than stripped — a table becomes tab-separated
 * columns that a spreadsheet understands, a list keeps its bullets — because the
 * alternative is a wall of prose that has lost the shape that made it readable.
 * Maths keeps its LaTeX, which is the only lossless plain form it has.
 */
export function markdownToPlainText(md: string): string {
  const lines = (md || "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = line.match(FENCE);
    if (fence) { inFence = !inFence; continue; }
    if (inFence) { out.push(line); continue; }

    if (HR.test(line)) { out.push("───"); continue; }

    // Table rows become columns; the |---| separator disappears.
    if (line.includes("|") && /^[\s|:-]+$/.test(line) && line.includes("-")) continue;
    if (line.includes("|") && splitCells(line.trim()).length > 1) {
      out.push(splitCells(line.trim()).map(inlineToText).join("\t"));
      continue;
    }

    let s = line
      .replace(/^ {0,3}(#{1,6})[ \t]+/, "")
      .replace(/^ {0,3}> ?/, "")
      .replace(/^([ \t]*)[-*+][ \t]+\[([ xX])\][ \t]+/, (_m, ind, mark) => `${ind}${mark === " " ? "☐" : "☑"} `)
      .replace(/^([ \t]*)[-*+][ \t]+/, "$1• ");
    out.push(inlineToText(s));
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Inline markers removed, links kept as "text (url)" so they survive the paste. */
function inlineToText(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_m, text, url) => (text && text !== url ? `${text} (${url})` : url))
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
    .replace(/\*\*([\s\S]+?)\*\*/g, "$1")
    .replace(/__([\s\S]+?)__/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/~~([\s\S]+?)~~/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!$~|<>])/g, "$1");
}
