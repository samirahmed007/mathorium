// Pix2Text MFR (Math Formula Recognition) — direct onnxruntime-web engine.
//
// Why not transformers.js? The bundled `decoder_model_merged.onnx` is a byte-identical
// copy of `decoder_model.onnx`: its only inputs are `input_ids` + `encoder_hidden_states`,
// with no `use_cache_branch` / `past_key_values.*` / `present.*`. transformers.js v3 drives
// VisionEncoderDecoder with KV-cache semantics, so the session inputs never match and the
// pipeline throws. Driving ORT directly avoids that contract entirely.
//
// Recipe verified against upstream pix2text (breezedeus/pix2text) and against the same
// model files shipped in a known-working desktop app:
//   preprocess : RGB → stretch-resize to 384×384 (no aspect padding) → /255 → (x-0.5)/0.5
//   generate   : start token 2, greedy argmax, stop at EOS 2, cap 512 new tokens
//   detokenize : ByteLevel BPE (GPT-2 byte↔unicode), drop ids 0-4
//   postprocess: upstream LaTeX cleanup (unmatched \left\right, empty accents, spacing)
//
// Aspect-preserving pad was measured to be *worse* than a plain stretch, matching
// DeiTImageProcessor's behaviour (do_center_crop: false, size 384×384, resample bicubic).
// See preprocess() for the measured comparison behind the resize choice.

import * as ort from "onnxruntime-web";
import { reconcileDelimiterShapes, type RepairIssue } from "./pix2textRepair";

export interface Pix2TextLoadOpts {
  modelPath?: string;
  onProgress?: (progress: number, status: string) => void;
  signal?: AbortSignal;
}

export interface Pix2TextRunOpts {
  maxNewTokens?: number;
  onProgress?: (progress: number, status: string) => void;
  signal?: AbortSignal;
  /**
   * Record the runner-up tokens at each decoding step (see Pix2TextResult.alternatives).
   * Costs one extra partial sort per step over a 1.2k vocab — negligible next to the
   * decoder run itself — so the Convert tab leaves it on whenever repair is enabled.
   */
  collectAlternatives?: boolean;
}

/** One candidate token at a decoding step, with its log-probability. */
export interface TokenAlternative {
  id: number;
  text: string;
  logProb: number;
}

export interface Pix2TextResult {
  latex: string;
  raw: string;
  tokens: number;
  encodeMs: number;
  decodeMs: number;
  /**
   * True when decoding ended in a repeating cycle or hit the token cap instead of
   * emitting EOS. The text is unreliable and callers should treat it as a failure
   * rather than a result — see hasRepeatingTail().
   */
  degenerate: boolean;
  /**
   * Per-generated-token runner-up list, present only when
   * `Pix2TextRunOpts.collectAlternatives` is set. `alternatives[i]` describes the
   * distribution at the step that produced generated token `i`, best first, so
   * `alternatives[i][0]` is always the token that was actually emitted.
   *
   * This exists because the model's single most consistent failure is picking the
   * wrong *shape* of delimiter — a tall `(` read as `[`. That error is invisible in
   * the text (a `[…]` pair is perfectly well-formed) but it is visible in the
   * distribution, where the correct bracket sits just behind the wrong one. The
   * repair layer uses these runner-ups to decide when a delimiter is a coin-flip
   * that the surrounding structure can settle — see pix2textRepair.ts.
   */
  alternatives?: TokenAlternative[][];
  /**
   * What the token-level delimiter reconciliation corrected, and which delimiters it
   * could only flag as close calls. Present alongside `alternatives`.
   */
  delimiterIssues?: RepairIssue[];
}

/**
 * Where the bundled model lives, resolved against `document.baseURI` for the same
 * reason `localWasmPath()` is: a root-absolute `/models/...` only works when the app
 * is served from a domain root, and Mathorium is meant to be copied onto a USB stick,
 * a shared drive, or a GitHub Pages project sub-path and still read formulas offline.
 */
function defaultModelPath(): string {
  try {
    // No trailing slash — callers append `/tokenizer.json` etc.
    return new URL("models/pix2text-mfr-quantized", document.baseURI).href;
  } catch {
    return "/models/pix2text-mfr-quantized";
  }
}

// From config.json / generation_config.json (both copies agree).
const IMAGE_SIZE = 384;
const DECODER_START_TOKEN_ID = 2;
const EOS_TOKEN_ID = 2;
const MAX_NEW_TOKENS = 512;
const NUM_SPECIAL_IDS = 5; // <pad> <s> </s> <unk> <mask>

/**
 * How many runner-up tokens to record per step when alternatives are requested.
 * Five comfortably covers the competing delimiter shapes; going deeper only adds
 * scan passes over the vocab for tokens no repair rule ever consults.
 */
const ALTERNATIVES_TOP_K = 5;

// ---------------------------------------------------------------------------
// ORT runtime setup
// ---------------------------------------------------------------------------

/**
 * Multi-threaded WASM needs SharedArrayBuffer, which needs COOP+COEP response
 * headers. Mathorium ships as a single static file (often opened over plain HTTP
 * or file://), so we must not assume isolation — ORT would throw instead of
 * silently degrading. Probe, then pick a thread count we can actually honour.
 */
function pickThreadCount(): number {
  try {
    const isolated = typeof crossOriginIsolated !== "undefined" && crossOriginIsolated === true;
    const hasSAB = typeof SharedArrayBuffer !== "undefined";
    if (!isolated || !hasSAB) return 1;
    const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
    return Math.max(1, Math.min(4, cores));
  } catch {
    return 1;
  }
}

/** onnxruntime-web's own WASM binaries, copied into `public/ort/` by the build. */
function localWasmPath(): string {
  try {
    // baseURI-relative so the app still works when served from a sub-path.
    return new URL("ort/", document.baseURI).href;
  } catch {
    return "/ort/";
  }
}

function configureORT(): void {
  ort.env.wasm.wasmPaths = localWasmPath();
  ort.env.wasm.numThreads = pickThreadCount();
  ort.env.logLevel = "error";
}

// ---------------------------------------------------------------------------
// ByteLevel BPE detokenizer
// ---------------------------------------------------------------------------

/** GPT-2 `bytes_to_unicode`, inverted: printable unicode char → original byte. */
function buildByteDecoder(): Map<string, number> {
  const bs: number[] = [];
  for (let i = 0x21; i <= 0x7e; i++) bs.push(i);
  for (let i = 0xa1; i <= 0xac; i++) bs.push(i);
  for (let i = 0xae; i <= 0xff; i++) bs.push(i);
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n);
      n++;
    }
  }
  const map = new Map<string, number>();
  for (let i = 0; i < bs.length; i++) map.set(String.fromCharCode(cs[i]), bs[i]);
  return map;
}

interface Tokenizer {
  id2tok: string[];
  byteDecoder: Map<string, number>;
}

let tokenizer: Tokenizer | null = null;

async function loadTokenizer(modelPath: string, signal?: AbortSignal): Promise<Tokenizer> {
  if (tokenizer) return tokenizer;
  const res = await fetch(`${modelPath}/tokenizer.json`, { signal });
  if (!res.ok) throw new Error(`tokenizer.json ${res.status} at ${modelPath}`);
  const json = await res.json();
  const vocab: Record<string, number> = json?.model?.vocab;
  if (!vocab) throw new Error("tokenizer.json has no model.vocab");
  const id2tok: string[] = [];
  for (const [tok, id] of Object.entries(vocab)) id2tok[id as number] = tok;
  tokenizer = { id2tok, byteDecoder: buildByteDecoder() };
  return tokenizer;
}

/** Decode generated ids → text, dropping special tokens. */
function detokenize(ids: number[], tk: Tokenizer): string {
  let joined = "";
  for (const id of ids) {
    if (id < NUM_SPECIAL_IDS) continue; // <pad> <s> </s> <unk> <mask>
    const tok = tk.id2tok[id];
    if (tok !== undefined) joined += tok;
  }
  const bytes = new Uint8Array(joined.length);
  let n = 0;
  for (const ch of joined) {
    const b = tk.byteDecoder.get(ch);
    if (b !== undefined) bytes[n++] = b;
  }
  return new TextDecoder("utf-8").decode(bytes.subarray(0, n));
}

// ---------------------------------------------------------------------------
// Image preprocessing
// ---------------------------------------------------------------------------

async function decodeImage(src: string): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    const res = await fetch(src);
    const blob = await res.blob();
    return await createImageBitmap(blob);
  }
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode image"));
    img.src = src;
  });
}

/**
 * DeiT preprocessing: resize to 384×384 as a plain stretch (no aspect padding —
 * `do_center_crop: false`), rescale 1/255, normalize with mean/std 0.5, emit CHW
 * float32.
 *
 * The resize deliberately uses the browser's own high-quality `drawImage` scaler
 * rather than a hand-rolled PIL-equivalent bicubic. That is a measured choice,
 * not an accident. On Test_Image/5848-309.png (944×131), whose first fraction
 * reads `\tilde{z}/\sigma_s` in the source bitmap:
 *
 *   canvas drawImage (this code) → \frac{\tilde{z}}{\sigma_{s}}   ✓ correct
 *   PIL BICUBIC / BILINEAR / LANCZOS stretch → \frac{z}{\sigma_{s}}  ✗ tilde lost
 *   PIL NEAREST stretch                     → badly mangled
 *   aspect-preserving pad (any filter)       → \bar{z}, \Psi, \sigma(·)  ✗ worse
 *
 * So matching PIL bit-for-bit would *reduce* accuracy here: PIL's antialiasing
 * averages the thin tilde stroke away, while the canvas scaler retains enough
 * contrast for the decoder to see it. Do not "fix" this to match a Python
 * reference without re-running that comparison.
 */
function preprocess(img: ImageBitmap | HTMLImageElement, padToAspect = 0): Float32Array {
  const canvas = document.createElement("canvas");
  canvas.width = IMAGE_SIZE;
  canvas.height = IMAGE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  // White backdrop so transparent PNGs (common in cropped formulas) read as paper.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, IMAGE_SIZE, IMAGE_SIZE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const iw = (img as HTMLImageElement).naturalWidth || img.width;
  const ih = (img as HTMLImageElement).naturalHeight || img.height;

  if (padToAspect > 0 && iw / ih > padToAspect) {
    // Letterbox onto a `padToAspect`-wide white canvas first, so the stretch to 1:1
    // has less horizontal distortion to apply. See VARIANTS for why this exists.
    const boxH = iw / padToAspect;
    const dh = (IMAGE_SIZE * ih) / boxH;
    ctx.drawImage(img as CanvasImageSource, 0, (IMAGE_SIZE - dh) / 2, IMAGE_SIZE, dh);
  } else {
    ctx.drawImage(img as CanvasImageSource, 0, 0, IMAGE_SIZE, IMAGE_SIZE);
  }

  const { data } = ctx.getImageData(0, 0, IMAGE_SIZE, IMAGE_SIZE);
  const plane = IMAGE_SIZE * IMAGE_SIZE;
  const out = new Float32Array(3 * plane);
  for (let p = 0, i = 0; p < plane; p++, i += 4) {
    // (v/255 - 0.5) / 0.5  ==  v/127.5 - 1
    out[p] = data[i] / 127.5 - 1;
    out[plane + p] = data[i + 1] / 127.5 - 1;
    out[2 * plane + p] = data[i + 2] / 127.5 - 1;
  }
  return out;
}

/**
 * Preprocessing variants tried for wide crops, best-confidence wins.
 *
 * No single resize is best for every image — measured on all 39 Test_Image
 * formulas with the shipped int8 decoder:
 *
 *   5848-309 (7.2:1)  plain stretch keeps `\tilde{z}`; pad→6:1 loses nothing but scores worse
 *   5848-167 (11.5:1) plain stretch invents `_{x \geq 0 \atop x \geq 0}`; pad→6:1 is clean
 *   5848-326 (11.0:1) plain stretch reads `F_s`/`\mu_s` correctly; pad→6:1 misreads them `F_i`/`\mu_i`
 *   5848-33  (11.4:1) plain stretch mangles `x^\ast` into `x^{\boldsymbol{x}}`; pad→6:1 is correct
 *   5848-55  (8.6:1)  plain stretch reads `\epsilon`; pad→6:1 correctly reads `\varepsilon`
 *   5848-327 (4.5:1)  plain stretch emits a broken `\phi \mathbf (`; pad→4:1 gives matched `\Biggl(`
 *
 * Mean per-token log-probability picks the correct variant in every one of those
 * cases, so the model's own confidence is the tie-breaker rather than a heuristic
 * on aspect ratio. Quantization was ruled out as a factor first: int8 and fp32
 * decoders produce byte-identical output on these images.
 *
 * Narrow crops (≤ the smallest pad target) only ever produce one distinct image,
 * so they cost a single pass — the extra work is spent only where it pays.
 */
const VARIANTS: { name: string; padToAspect: number }[] = [
  { name: "stretch", padToAspect: 0 },
  { name: "pad6", padToAspect: 6 },
  { name: "pad4", padToAspect: 4 },
];

// ---------------------------------------------------------------------------
// LaTeX post-processing (ported from pix2text/latex_ocr.py)
// ---------------------------------------------------------------------------

const WHITESPACE_CMDS = [
  "\\\\ +",
  "\\\\quad\\s*",
  "\\\\qquad\\s*",
  "\\\\,\\s*",
  "\\\\:\\s*",
  "\\\\;\\s*",
  "\\\\enspace\\s*",
  "\\\\thinspace\\s*",
  "\\\\!\\s*",
];

function removeRedundantScript(text: string): string {
  let out = text.replace(/^\^\s*\{\s*(.*?)\s*\}/, "$1");
  out = out.replace(/^_\s*\{\s*(.*?)\s*\}/, "$1");
  return out.trim();
}

function removeTrailingWhitespace(text: string): string {
  const re = new RegExp(`(?:${WHITESPACE_CMDS.join("|")})+$`);
  return text.replace(re, "").trim();
}

function replaceIllegalSymbols(text: string): string {
  return text
    .replace(/\\\./g, "\\ .")
    .replace(/\\=/g, "\\ =")
    .replace(/\\-/g, "\\ -")
    .replace(/\\~/g, "\\ ~");
}

const EMPTY_GROUP_PATTERNS = [
  /\\hat\s*\{\s*\}/g,
  /\^\s*\{\s*\}/g,
  /_\s*\{\s*\}/g,
  /\\text\s*\{\s*\}/g,
  /\\tilde\s*\{\s*\}/g,
  /\\bar\s*\{\s*\}/g,
  /\\vec\s*\{\s*\}/g,
  /\\acute\s*\{\s*\}/g,
  /\\grave\s*\{\s*\}/g,
  /\\breve\s*\{\s*\}/g,
  /\\overline\s*\{\s*\}/g,
  /\\dot\s*\{\s*\}/g,
  /\\ddot\s*\{\s*\}/g,
  /\\widehat\s*\{\s*\}/g,
  /\\widetilde\s*\{\s*\}/g,
];

function removeEmptyText(text: string): string {
  let out = text;
  for (const re of EMPTY_GROUP_PATTERNS) out = out.replace(re, "");
  // `{{} \mathrm{if} ...}` — a stray empty group right after an opening brace. The
  // model emits these in cases-style rows; a bare `{}` elsewhere can be meaningful
  // (prescripts), so only the immediately-nested form is stripped.
  out = out.replace(/\{\s*\{\s*\}\s*/g, "{");
  return out.trim();
}

/**
 * `\l` is not a valid command in math mode — KaTeX renders it as red error text.
 * The model emits it where the source simply has the variable `l` (5848-1,
 * 5848-137: `\l^{\prime}(x) < 0`, `\mathbb{I}_{\{x<s\}} \l(x)+cx`).
 *
 * The negative lookahead keeps every real command that merely starts with `l`
 * (`\left`, `\leq`, `\log`, `\lim`, `\ll`, `\lambda`, `\ldots`, ...) intact.
 */
function repairInvalidCommands(text: string): string {
  return text.replace(/\\l(?![a-zA-Z])/g, "l");
}

/** Operators with a canonical LaTeX command, so `\operatorname{l o g}` → `\log`. */
const KNOWN_OPERATORS = new Set([
  "arccos", "arcsin", "arctan", "arg", "cos", "cosh", "cot", "coth", "csc",
  "deg", "det", "dim", "exp", "gcd", "hom", "inf", "ker", "lg", "lim",
  "liminf", "limsup", "ln", "log", "max", "min", "Pr", "sec", "sin",
  "sinh", "sup", "tan", "tanh",
]);

/**
 * Join letters the model split apart inside `\operatorname{}` / `\mathrm{}`.
 *
 * Pix2Text tokenizes operator names one letter at a time and round-trips them as
 * `\operatorname*{m a x}`, `\mathrm{w h e r e}`, `\mathrm{F B}`. Math mode ignores
 * those spaces, so this is visually a no-op — but MathML export emits the spaces
 * verbatim (`<mi>m a x</mi>`), which corrupts the exported markup and any
 * downstream copy/paste. Collapsing them is therefore an export-correctness fix.
 *
 * `\operatorname*{m a x}` further becomes `\max`, preserving limit placement
 * because `\max`/`\min`/`\lim` are limits-style operators exactly like the starred
 * form.
 */
function collapseSpacedOperators(text: string): string {
  const joinLetters = (body: string): string => {
    const trimmed = body.trim();
    // Only collapse a run of single characters separated by whitespace — leave
    // anything with real multi-character words or symbols alone.
    if (!/^[A-Za-z](?:\s+[A-Za-z])+$/.test(trimmed)) return trimmed;
    return trimmed.replace(/\s+/g, "");
  };
  let out = text.replace(/\\operatorname(\*?)\s*\{([^{}]*)\}/g, (m, star: string, body: string) => {
    const name = joinLetters(body);
    if (!/^[A-Za-z]+$/.test(name)) return m;
    if (KNOWN_OPERATORS.has(name)) return `\\${name}`;
    return `\\operatorname${star}{${name}}`;
  });
  out = out.replace(/\\mathrm\s*\{([^{}]*)\}/g, (m, body: string) => {
    const name = joinLetters(body);
    return /^[A-Za-z]+$/.test(name) ? `\\mathrm{${name}}` : m;
  });
  return out;
}

/**
 * Left-align cases blocks so they match the source layout.
 *
 * `\left\{ \begin{matrix} ... \end{matrix} \right.` is the cases idiom, but
 * `matrix` *centres* every column: on 5848-8 the source has `cx` and `l(x)+cx`
 * flush left, while the centred render floats them. `aligned` is worse — it uses
 * rl alignment with no inter-column gap, so 5848-11's `{s} & {\mathrm{if} ...}`
 * renders as `sif` jammed together.
 *
 * LaTeX's own `cases` is defined as `\left\{\begin{array}{ll}...\right.`, so
 * rewriting to a left-aligned `array` reproduces the source exactly.
 *
 * Scoped deliberately to the `\left\{`-wrapped form: a bare `matrix`/`pmatrix`
 * is a real matrix, where centred columns are correct and must stay untouched.
 */
function fixCasesAlignment(text: string): string {
  return text.replace(
    /\\left\s*\\\{\s*\\begin\s*\{(matrix|aligned)\}([\s\S]*?)\\end\s*\{\1\}/g,
    (_m, _env: string, body: string) => {
      const rows = body.split(/\\\\/);
      let cols = 1;
      for (const row of rows) {
        const amps = (row.match(/(?:^|[^\\])&/g) || []).length;
        if (amps + 1 > cols) cols = amps + 1;
      }
      return `\\left\\{ \\begin{array}{${"l".repeat(cols)}}${body}\\end{array}`;
    },
  );
}

const LEFT_RIGHT_PAIRS = new Set([
  "|",
  "(|)",
  "\\{|.",
  "⟮|⟯",
  "[|]",
  "⟨|⟩",
  "{|}",
  "⌈|⌉",
  "┌|┐",
  "⌊|⌋",
  "└|┘",
  "⎰|⎱",
  "lt|gt",
  "lang|rang",
  "langle|rangle",
  "lbrace|rbrace",
  "lBrace|rBrace",
  "lbracket|rbracket",
  "lceil|rceil",
  "lcorner|rcorner",
  "lfloor|rfloor",
  "lgroup|rgroup",
  "lmoustache|rmoustache",
  "lparen|rparen",
  "lvert|rvert",
  "lVert|rVert",
]);

interface BracketInfo {
  str: string;
  start: number;
  end: number;
  matched?: boolean;
}

const ASCII_LETTER = /[A-Za-z]/;

/** Locate every `\left`/`\right` and the delimiter token that follows it. */
function findAllLeftOrRight(latex: string, kind: "left" | "right"): BracketInfo[] {
  const infos: BracketInfo[] = [];
  const prefixLen = kind.length + 1;
  const re = new RegExp(`\\\\${kind}\\s*\\S`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(latex)) !== null) {
    const start = m.index;
    let end = m.index + m[0].length;
    // A letter directly after `\left` means it wasn't a delimiter (e.g. `\lefteqn`).
    if (ASCII_LETTER.test(latex[end - 1])) continue;
    // Absorb a following command such as `\left \big(`.
    while (latex[end - 1] === "\\" || latex[end - 1] === " ") {
      end += 1;
      while (end < latex.length && ASCII_LETTER.test(latex[end])) end += 1;
    }
    infos.push({ str: latex.slice(start + prefixLen, end).trim(), start, end });
  }
  infos.sort((a, b) => a.start - b.start);
  return infos;
}

function matchLeftRight(leftStr: string, rightStr: string): boolean {
  let l = leftStr.trim().replace(/ /g, "").slice("left".length + 1);
  let r = rightStr.trim().replace(/ /g, "").slice("right".length + 1);
  while (l.length && r.length && l[0] === r[0]) {
    l = l.slice(1);
    r = r.slice(1);
  }
  return LEFT_RIGHT_PAIRS.has(`${l}|${r}`);
}

/** Blank out `\left`/`\right` that have no partner — KaTeX hard-errors on those. */
function fixLatex(latex: string): string {
  let out = latex;
  const lefts = findAllLeftOrRight(out, "left");
  const rights = findAllLeftOrRight(out, "right");
  for (const left of lefts) {
    for (const right of rights) {
      if (!right.matched && right.start > left.start && matchLeftRight(right.str, left.str)) {
        left.matched = true;
        right.matched = true;
        break;
      }
    }
  }
  const blank = (info: BracketInfo, len: number) => {
    const startIdx = info.start;
    const endIdx = startIdx + len;
    out = out.slice(0, startIdx) + " ".repeat(endIdx - startIdx) + out.slice(endIdx);
  };
  for (const left of lefts) if (!left.matched) blank(left, "left".length + 1);
  for (const right of rights) if (!right.matched) blank(right, "right".length + 1);
  return out.replace(/\s+/g, " ").trim();
}

function removeUnnecessarySpaces(latex: string): string {
  let out = latex;
  // Keep one space between a command and a following letter, drop it otherwise.
  out = out.replace(/\\([a-zA-Z]+) (?=[a-zA-Z])/g, "\\$1 ");
  out = out.replace(/\\([a-zA-Z]+)\s+(?![a-zA-Z])/g, "\\$1");
  out = out.replace(/(\{)\s+/g, "$1");
  out = out.replace(/\s+(\})/g, "$1");
  out = out.replace(/([^\\])\s*([+\-=])\s*/g, "$1$2");
  out = out.replace(/\s*(\^|_)\s*/g, "$1");
  return out;
}

/**
 * Upstream pix2text cleanup chain, plus the repairs measured as necessary on the
 * Test_Image corpus (invalid `\l`, letter-split operator names, centred cases
 * blocks). The upstream steps keep their original order and semantics.
 */
export function postProcessLatex(text: string): string {
  let out = removeRedundantScript(text);
  out = removeTrailingWhitespace(out);
  out = replaceIllegalSymbols(out);
  out = repairInvalidCommands(out);
  for (let i = 0; i < 10; i++) {
    const next = removeEmptyText(out);
    if (next === out) break;
    out = next;
  }
  out = fixLatex(out);
  // After fixLatex: whitespace is normalised to single spaces, so the structural
  // rewrites below see a predictable shape.
  out = fixCasesAlignment(out);
  out = collapseSpacedOperators(out);
  out = removeUnnecessarySpaces(out);
  return out.trim();
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

interface Sessions {
  encoder: ort.InferenceSession;
  decoder: ort.InferenceSession;
}

let sessions: Sessions | null = null;
let loading: Promise<Sessions> | null = null;

/** Prefer the smaller int8 decoder; fall back to the fp32 original. */
const DECODER_CANDIDATES = ["onnx/decoder_model_int8.onnx", "onnx/decoder_model.onnx"];

async function fetchWithProgress(
  url: string,
  label: string,
  onProgress?: (p: number, s: string) => void,
  base = 0,
  span = 1,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${label} ${res.status}`);
  const total = Number(res.headers.get("content-length") || 0);
  if (!res.body || !total) {
    onProgress?.(base + span, `${label} loaded`);
    return await res.arrayBuffer();
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(base + (received / total) * span, `${label} ${Math.round((received / total) * 100)}%`);
  }
  const buf = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  return buf.buffer;
}

export async function loadPix2Text(opts: Pix2TextLoadOpts = {}): Promise<Sessions> {
  if (sessions) return sessions;
  if (loading) return loading;

  const modelPath = opts.modelPath || defaultModelPath();
  const { onProgress, signal } = opts;

  loading = (async () => {
    onProgress?.(0.02, "Preparing math OCR engine...");

    await loadTokenizer(modelPath, signal);
    onProgress?.(0.05, "Tokenizer ready");

    const sessionOpts: ort.InferenceSession.SessionOptions = {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
      executionMode: "sequential",
      intraOpNumThreads: pickThreadCount(),
    };

    const encBuf = await fetchWithProgress(
      `${modelPath}/onnx/encoder_model.onnx`,
      "Vision encoder",
      onProgress,
      0.05,
      0.45,
      signal,
    );
    onProgress?.(0.5, "Initializing encoder...");

    // Desktop OCR is air-gapped: use only the packaged local WASM runtime.
    // A missing or incompatible runtime is a hard, visible failure; never contact a CDN.
    configureORT();
    let encoder: ort.InferenceSession;
    try {
      encoder = await ort.InferenceSession.create(encBuf, sessionOpts);
    } catch (e) {
      throw new Error(
        `Bundled ONNX Runtime failed to start from ${localWasmPath()} (${(e as Error)?.message || e}). ` +
          `Offline OCR will not attempt a network fallback. Repair or reinstall the local runtime assets.`,
      );
    }

    let decoder: ort.InferenceSession | null = null;
    let lastErr: unknown = null;
    for (let i = 0; i < DECODER_CANDIDATES.length; i++) {
      try {
        const buf = await fetchWithProgress(
          `${modelPath}/${DECODER_CANDIDATES[i]}`,
          "Text decoder",
          onProgress,
          0.5,
          0.4,
          signal,
        );
        onProgress?.(0.92, "Initializing decoder...");
        decoder = await ort.InferenceSession.create(buf, sessionOpts);
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!decoder) throw new Error(`Could not load decoder: ${(lastErr as Error)?.message || lastErr}`);

    onProgress?.(1, "Math OCR engine ready");
    sessions = { encoder, decoder };
    return sessions;
  })();

  try {
    return await loading;
  } catch (e) {
    loading = null;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Inference
// ---------------------------------------------------------------------------

/**
 * True when the tail of `ids` is a short block repeated over and over.
 *
 * Greedy decoding with no repetition penalty degenerates on images that hold no
 * formula: instead of emitting EOS the decoder cycles, e.g. `\chi_{\pm}` 52 times
 * on a blank page. That output is worthless but *looks* like a successful result,
 * which is exactly the "confident garbage" failure this engine must not produce.
 * Detecting it lets the caller fail honestly (and lets cloud vision take over).
 */
function hasRepeatingTail(ids: number[], maxCycle = 12, minRepeats = 6): boolean {
  for (let p = 1; p <= maxCycle; p++) {
    const need = p * minRepeats;
    if (ids.length < need) break;
    const tail = ids.slice(ids.length - need);
    let cyclic = true;
    for (let i = p; i < need && cyclic; i++) {
      if (tail[i] !== tail[i % p]) cyclic = false;
    }
    if (cyclic) return true;
  }
  return false;
}

/**
 * Greedy pick from the last row, plus that pick's log-probability.
 *
 * The log-prob is computed with the log-sum-exp trick (subtract the max before
 * exponentiating) so it stays finite for the large logits this decoder produces.
 * Averaged over a sequence it becomes the confidence score that chooses between
 * preprocessing variants — see VARIANTS.
 */
function argmaxLastRow(logits: ort.Tensor, topK = 0): { id: number; logProb: number; top: { id: number; logProb: number }[] } {
  const dims = logits.dims as number[];
  const vocab = dims[dims.length - 1];
  const seq = dims.length >= 2 ? dims[dims.length - 2] : 1;
  const data = logits.data as Float32Array;
  const offset = (seq - 1) * vocab;
  let best = 0;
  let bestVal = -Infinity;
  for (let v = 0; v < vocab; v++) {
    const val = data[offset + v];
    if (val > bestVal) {
      bestVal = val;
      best = v;
    }
  }
  let sumExp = 0;
  for (let v = 0; v < vocab; v++) sumExp += Math.exp(data[offset + v] - bestVal);
  // log softmax(x_i) = (x_i - max) - log(sum exp(x - max))
  const logZ = Math.log(sumExp);
  const logProb = -logZ;

  let top: { id: number; logProb: number }[] = [];
  if (topK > 0) {
    // Partial selection: the vocab is ~1.2k, so a full sort would be wasteful and a
    // k-pass scan is both simpler and faster for the small k the repair layer needs.
    const taken = new Set<number>();
    for (let k = 0; k < topK; k++) {
      let id = -1;
      let val = -Infinity;
      for (let v = 0; v < vocab; v++) {
        if (taken.has(v)) continue;
        if (data[offset + v] > val) {
          val = data[offset + v];
          id = v;
        }
      }
      if (id < 0) break;
      taken.add(id);
      top.push({ id, logProb: val - bestVal - logZ });
    }
  }
  return { id: best, logProb, top };
}

/**
 * Recognize a single cropped formula image → LaTeX.
 * `src` may be a data URL, blob URL, or same-origin URL.
 */
export async function recognizeFormula(src: string, opts: Pix2TextRunOpts = {}): Promise<Pix2TextResult> {
  const { maxNewTokens = MAX_NEW_TOKENS, onProgress, signal, collectAlternatives = false } = opts;
  const s = sessions || (await loadPix2Text({ onProgress, signal }));
  const tk = tokenizer!;

  const img = await decodeImage(src);
  const iw = (img as HTMLImageElement).naturalWidth || img.width;
  const ih = (img as HTMLImageElement).naturalHeight || img.height;
  const aspect = ih > 0 ? iw / ih : 1;

  // Only variants that actually produce a different bitmap are worth decoding:
  // padding to 6:1 is a no-op on a 3:1 crop, so narrow images stay single-pass.
  const variants = VARIANTS.filter((v) => v.padToAspect === 0 || aspect > v.padToAspect);

  let encodeMs = 0;
  let best: (Pix2TextResult & { score: number }) | null = null;

  for (let vi = 0; vi < variants.length; vi++) {
    if (signal?.aborted) throw new Error("Aborted");
    const variant = variants[vi];
    const label = variants.length > 1 ? ` (pass ${vi + 1}/${variants.length})` : "";
    const pixels = preprocess(img, variant.padToAspect);

    const t0 = performance.now();
    const pixelTensor = new ort.Tensor("float32", pixels, [1, 3, IMAGE_SIZE, IMAGE_SIZE]);
    const encOut = await s.encoder.run({ pixel_values: pixelTensor });
    const hidden = encOut[s.encoder.outputNames[0]] as ort.Tensor;
    encodeMs += performance.now() - t0;

    const t1 = performance.now();
    const ids: number[] = [DECODER_START_TOKEN_ID];
    const generated: number[] = [];
    const alternatives: TokenAlternative[][] = [];
    let logProbSum = 0;
    let scored = 0;

    // The upstream decoder is cache-less: its only inputs are `input_ids` and
    // `encoder_hidden_states` (generation_config.json sets `use_cache: false`, and the
    // HF repo ships ONNX only — no PyTorch weights — so a KV-cache re-export is not
    // possible). Each step therefore re-runs the full prefix: correct, but O(n²).
    let sawEos = false;
    let degenerate = false;
    for (let step = 0; step < maxNewTokens; step++) {
      if (signal?.aborted) throw new Error("Aborted");
      const idTensor = new ort.Tensor("int64", BigInt64Array.from(ids.map((v) => BigInt(v))), [1, ids.length]);
      const out = await s.decoder.run({ input_ids: idTensor, encoder_hidden_states: hidden });
      const { id: next, logProb, top } = argmaxLastRow(out.logits as ort.Tensor, collectAlternatives ? ALTERNATIVES_TOP_K : 0);
      logProbSum += logProb;
      scored++;
      ids.push(next);
      if (next === EOS_TOKEN_ID) {
        sawEos = true;
        break;
      }
      generated.push(next);
      if (collectAlternatives) {
        alternatives.push(top.map((t) => ({ id: t.id, text: detokenize([t.id], tk), logProb: t.logProb })));
      }
      // Bail out of a degenerate cycle instead of grinding to the 512-token cap:
      // on CPU every wasted step costs real seconds, and the text is junk anyway.
      if (generated.length >= 24 && generated.length % 4 === 0 && hasRepeatingTail(generated)) {
        degenerate = true;
        break;
      }
      if (step % 4 === 0) {
        // Most formulas land well under 200 tokens, so scale progress against that
        // and clamp — a hard cap of 512 would make the bar look stuck.
        const frac = (vi + Math.min(0.98, generated.length / 200)) / variants.length;
        onProgress?.(Math.min(0.98, frac), `Reading formula${label}... ${generated.length} tokens`);
        // Yield so the UI can paint between decoder steps.
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    const decodeMs = performance.now() - t1;

    // Running out of budget without EOS is the same failure wearing a different hat.
    if (!sawEos && !degenerate) degenerate = true;

    // Delimiter shape correction happens here, on the token sequence, because this is
    // the only place where the decoder's per-step alternatives still line up with what
    // it emitted. Once the ids become a string and postProcessLatex rewrites it, the
    // correspondence is gone. See reconcileDelimiterShapes for why the distribution is
    // the only thing that can see this class of error at all.
    let emitted = generated;
    let delimIssues: RepairIssue[] = [];
    if (collectAlternatives) {
      const rec = reconcileDelimiterShapes(alternatives);
      delimIssues = rec.issues;
      if (rec.fixes.size > 0) emitted = generated.map((id, i) => rec.fixes.get(i) ?? id);
    }

    const raw = detokenize(emitted, tk);
    const score = scored > 0 ? logProbSum / scored : -Infinity;
    const cand = {
      latex: postProcessLatex(raw),
      raw,
      tokens: generated.length,
      encodeMs,
      decodeMs,
      degenerate,
      ...(collectAlternatives ? { alternatives, delimiterIssues: delimIssues } : {}),
      score,
    };
    // A degenerate pass is never preferred over a converged one, however confident
    // its per-token scores looked while it was cycling.
    const better =
      !best ||
      (best.degenerate && !cand.degenerate) ||
      (best.degenerate === cand.degenerate && cand.score > best.score);
    if (better) best = cand;
  }

  if (!best) throw new Error("Pix2Text produced no result");
  if ("close" in img && typeof img.close === "function") img.close();

  const { score: _score, ...result } = best;
  return { ...result, encodeMs };
}

export function isPix2TextLoaded(): boolean {
  return sessions !== null;
}

export async function disposePix2Text(): Promise<void> {
  try {
    await sessions?.encoder.release();
    await sessions?.decoder.release();
  } catch {
    /* ignore */
  }
  sessions = null;
  loading = null;
}

export function getPix2TextThreadInfo(): { threads: number; isolated: boolean } {
  return {
    threads: pickThreadCount(),
    isolated: typeof crossOriginIsolated !== "undefined" && crossOriginIsolated === true,
  };
}
