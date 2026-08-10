/**
 * A small, dependency-free syntax highlighter for chat code blocks.
 *
 * Why not highlight.js, Prism or Shiki: this app builds to a single inlined
 * `index.html`, and the smallest of those adds a few hundred kB — more than the whole
 * rest of the UI — for a feature that decorates one kind of block. A regex tokenizer
 * gets most of the readability for ~4 kB.
 *
 * It is deliberately approximate. Real parsing is not the goal; telling a comment from
 * a string from a keyword at a glance is. Anything unrecognised stays plain, so an
 * unknown language degrades to today's monochrome rather than to nonsense.
 */

export type TokenKind =
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "type"
  | "func"
  | "tag"
  | "attr"
  | "op"
  | "plain";

export interface Token {
  k: TokenKind;
  v: string;
}

/**
 * A rule is a regex *source* plus the kind it produces. Sources must use only
 * non-capturing groups: `tokenize` maps a match back to its rule by group index, so a
 * stray capture would shift every kind after it.
 */
type Rule = [string, TokenKind];

function tokenize(code: string, rules: Rule[]): Token[] {
  const re = new RegExp(rules.map(([src]) => `(${src})`).join("|"), "gm");
  const out: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(code)) !== null) {
    // A zero-length match would spin forever; step past it.
    if (m[0] === "") { re.lastIndex++; continue; }
    if (m.index > last) out.push({ k: "plain", v: code.slice(last, m.index) });

    let kind: TokenKind = "plain";
    for (let i = 1; i < m.length; i++) {
      if (m[i] !== undefined) { kind = rules[i - 1][1]; break; }
    }
    out.push({ k: kind, v: m[0] });
    last = m.index + m[0].length;
  }
  if (last < code.length) out.push({ k: "plain", v: code.slice(last) });
  return out;
}

// Strings, shared by most of the C-descended languages: double, single and backtick,
// each allowing backslash escapes so an escaped quote does not end the token early.
const STR = String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|` + "`(?:[^`\\\\]|\\\\.)*`";
const NUM = String.raw`\b(?:0[xXbBoO][0-9a-fA-F_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?)\b`;

const CLIKE_KW =
  "abstract|as|async|await|break|case|catch|class|const|constexpr|continue|crate|" +
  "debugger|def|default|defer|delete|do|dyn|elif|else|enum|explicit|export|extends|" +
  "extern|final|finally|fn|for|foreach|friend|from|func|function|get|goto|guard|if|" +
  "impl|implements|import|in|inline|instanceof|interface|internal|is|let|lock|loop|" +
  "match|mod|move|mut|mutable|namespace|new|noexcept|operator|out|override|package|" +
  "private|protected|pub|public|readonly|ref|return|sealed|set|sizeof|static|struct|" +
  "super|switch|synchronized|template|this|throw|throws|trait|try|typedef|typeof|" +
  "union|unsafe|use|using|var|virtual|volatile|when|where|while|with|yield";

const CLIKE_TYPE =
  "bool|boolean|byte|char|double|float|int|long|short|signed|unsigned|void|string|" +
  "number|any|unknown|never|object|String|Array|Promise|Record|Map|Set|Vec|Option|" +
  "Result|i8|i16|i32|i64|u8|u16|u32|u64|f32|f64|usize|isize|str|true|false|null|" +
  "nil|nullptr|None|undefined|self|Self";

const CLIKE: Rule[] = [
  [String.raw`//[^\n]*|/\*[\s\S]*?\*/`, "comment"],
  [STR, "string"],
  [NUM, "number"],
  [String.raw`\b(?:${CLIKE_KW})\b`, "keyword"],
  [String.raw`\b(?:${CLIKE_TYPE})\b`, "type"],
  // An identifier immediately followed by `(` reads as a call or a definition.
  [String.raw`\b[A-Za-z_$][\w$]*(?=\s*\()`, "func"],
  [String.raw`[+\-*/%=<>!&|^~?:;,.@#]+`, "op"],
];

const PY_KW =
  "and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|" +
  "for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|" +
  "while|with|yield|match|case";

const PYTHON: Rule[] = [
  [String.raw`#[^\n]*`, "comment"],
  // Triple-quoted first, or the opening `"""` would match as an empty `""` plus a quote.
  [String.raw`[rbfu]{0,2}(?:"""[\s\S]*?"""|'''[\s\S]*?''')|[rbfu]{0,2}(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')`, "string"],
  [NUM, "number"],
  [String.raw`\b(?:${PY_KW})\b`, "keyword"],
  [String.raw`\b(?:True|False|None|self|cls|int|str|float|bool|list|dict|tuple|set|bytes)\b`, "type"],
  [String.raw`\b[A-Za-z_][\w]*(?=\s*\()`, "func"],
  [String.raw`[+\-*/%=<>!&|^~?:;,.@]+`, "op"],
];

const SHELL: Rule[] = [
  [String.raw`#[^\n]*`, "comment"],
  [String.raw`"(?:[^"\\]|\\.)*"|'[^']*'`, "string"],
  [NUM, "number"],
  [String.raw`\b(?:if|then|elif|else|fi|for|while|until|do|done|case|esac|in|function|return|local|export|source|alias|set|unset|shift|trap|exit|break|continue)\b`, "keyword"],
  [String.raw`\$(?:\{[^}]*\}|[A-Za-z_]\w*|\d|\?|!|@|\*|#)`, "type"],
  [String.raw`\b(?:echo|cd|ls|cat|grep|sed|awk|curl|git|npm|npx|node|python3?|pip3?|docker|kubectl|make|mkdir|rm|cp|mv|chmod|sudo|apt|brew)\b`, "func"],
  [String.raw`[|&;<>()$\\]+|[-]{1,2}[A-Za-z][\w-]*`, "op"],
];

const MARKUP: Rule[] = [
  [String.raw`<!--[\s\S]*?-->`, "comment"],
  [String.raw`<\/?[A-Za-z][\w:-]*`, "tag"],
  [String.raw`"(?:[^"\\]|\\.)*"|'[^']*'`, "string"],
  [String.raw`\b[A-Za-z_:][\w:.-]*(?=\s*=)`, "attr"],
  [String.raw`\/?>`, "tag"],
];

const CSS: Rule[] = [
  [String.raw`/\*[\s\S]*?\*/`, "comment"],
  [String.raw`"(?:[^"\\]|\\.)*"|'[^']*'`, "string"],
  [String.raw`@[A-Za-z-]+`, "keyword"],
  [String.raw`--[\w-]+|\b[a-z-]+(?=\s*:)`, "attr"],
  [String.raw`#[0-9a-fA-F]{3,8}\b|\b\d[\d.]*(?:px|em|rem|%|vh|vw|s|ms|deg|fr|pt)?\b`, "number"],
  [String.raw`[.#][\w-]+|::?[a-z-]+`, "type"],
  [String.raw`[{}:;,>+~*()]+`, "op"],
];

const JSON_RULES: Rule[] = [
  [String.raw`"(?:[^"\\]|\\.)*"(?=\s*:)`, "attr"],
  [String.raw`"(?:[^"\\]|\\.)*"`, "string"],
  [NUM, "number"],
  [String.raw`\b(?:true|false|null)\b`, "type"],
  [String.raw`[{}\[\]:,]+`, "op"],
];

const SQL: Rule[] = [
  [String.raw`--[^\n]*|/\*[\s\S]*?\*/`, "comment"],
  [String.raw`'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.)*"`, "string"],
  [NUM, "number"],
  [String.raw`\b(?:SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|ALTER|DROP|TABLE|VIEW|INDEX|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|ON|AS|AND|OR|NOT|NULL|IS|IN|LIKE|BETWEEN|GROUP|BY|ORDER|HAVING|LIMIT|OFFSET|UNION|ALL|DISTINCT|CASE|WHEN|THEN|ELSE|END|WITH|PRIMARY|FOREIGN|KEY|REFERENCES|CONSTRAINT|DEFAULT|CASCADE|RETURNING|BEGIN|COMMIT|ROLLBACK)\b`, "keyword"],
  [String.raw`\b(?:INT|INTEGER|BIGINT|SMALLINT|DECIMAL|NUMERIC|REAL|DOUBLE|SERIAL|VARCHAR|CHAR|TEXT|BOOLEAN|DATE|TIME|TIMESTAMP|UUID|JSON|JSONB|BLOB)\b`, "type"],
  [String.raw`\b(?:COUNT|SUM|AVG|MIN|MAX|COALESCE|CAST|NOW|ROUND|LOWER|UPPER|LENGTH|SUBSTRING)(?=\s*\()`, "func"],
  [String.raw`[=<>!+\-*/%|,;().]+`, "op"],
];

const TEX: Rule[] = [
  [String.raw`%[^\n]*`, "comment"],
  [String.raw`\\(?:begin|end|documentclass|usepackage|newcommand|renewcommand|def|section|subsection|subsubsection|chapter|paragraph|label|ref|cite|item|caption|includegraphics|input|include)\b`, "keyword"],
  [String.raw`\\[A-Za-z@]+\*?`, "func"],
  [String.raw`\\[^A-Za-z]`, "string"],
  [String.raw`\{[A-Za-z*]+\}(?=\s*(?:\{|\[|$))`, "type"],
  [NUM, "number"],
  [String.raw`[{}\[\]$&_^~#]+`, "op"],
];

const YAML: Rule[] = [
  [String.raw`#[^\n]*`, "comment"],
  [String.raw`"(?:[^"\\]|\\.)*"|'[^']*'`, "string"],
  [String.raw`^\s*-?\s*[\w.-]+(?=\s*:)`, "attr"],
  [NUM, "number"],
  [String.raw`\b(?:true|false|null|yes|no|on|off|~)\b`, "type"],
  [String.raw`[:>|&*\-]+`, "op"],
];

const DIFF: Rule[] = [
  [String.raw`^diff[^\n]*|^index[^\n]*|^@@[^\n]*@@`, "comment"],
  [String.raw`^\+[^\n]*`, "string"],   // additions read as green
  [String.raw`^-[^\n]*`, "keyword"],   // removals read as red
];

/**
 * Language aliases → rule set. The key is what a fence says after the backticks; the
 * canonical names come from `extForLang`'s map so the two stay in step.
 */
const BY_LANG: Record<string, Rule[]> = {};
const register = (rules: Rule[], ...names: string[]) => names.forEach((n) => { BY_LANG[n] = rules; });

register(CLIKE,
  "js", "javascript", "mjs", "cjs", "jsx", "ts", "typescript", "tsx", "java", "c", "h",
  "cpp", "c++", "cc", "hpp", "cs", "csharp", "go", "golang", "rs", "rust", "kt", "kotlin",
  "swift", "dart", "scala", "php", "groovy", "vue", "svelte", "zig", "v");
register(PYTHON, "py", "python", "python3", "pyi");
register(SHELL, "sh", "bash", "zsh", "shell", "console", "terminal", "ps1", "powershell", "fish");
register(MARKUP, "html", "htm", "xml", "svg", "xhtml", "jsx-html", "astro");
register(CSS, "css", "scss", "sass", "less", "stylus");
register(JSON_RULES, "json", "json5", "jsonc", "geojson");
register(SQL, "sql", "postgres", "postgresql", "mysql", "sqlite", "plsql");
register(TEX, "tex", "latex", "katex", "bibtex");
register(YAML, "yaml", "yml", "toml", "ini", "cfg", "conf", "properties", "env", "dotenv");
register(DIFF, "diff", "patch");
// Ruby/Perl/Lua/R/Julia/Elixir are close enough to the C-like set to read correctly.
register(CLIKE, "rb", "ruby", "perl", "pl", "lua", "r", "jl", "julia", "ex", "exs", "elixir", "erl", "hs", "haskell", "ml", "fs", "fsharp", "clj", "clojure", "nim", "cr");

/** Is there a rule set for this fence label? */
export function canHighlight(lang: string): boolean {
  return Boolean(BY_LANG[(lang || "").toLowerCase()]);
}

/**
 * Split `code` into coloured tokens. An unknown language yields a single plain token,
 * so callers can render the result unconditionally.
 */
export function highlight(code: string, lang: string): Token[] {
  const rules = BY_LANG[(lang || "").toLowerCase()];
  if (!rules || !code) return [{ k: "plain", v: code }];
  try {
    return tokenize(code, rules);
  } catch {
    // A pathological input should never cost the user their code block.
    return [{ k: "plain", v: code }];
  }
}

/** Tailwind text colour per token kind, tuned against the app's `#0a0f1c` code panel. */
export const TOKEN_CLASS: Record<TokenKind, string> = {
  comment: "text-slate-500 italic",
  string: "text-emerald-300",
  number: "text-amber-300",
  keyword: "text-violet-300",
  type: "text-sky-300",
  func: "text-yellow-200",
  tag: "text-rose-300",
  attr: "text-cyan-300",
  op: "text-slate-400",
  plain: "text-slate-200",
};

