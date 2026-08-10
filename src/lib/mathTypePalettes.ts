// MathType-style palettes for the visual equation editor.
//
// The layout mirrors the desktop MathType toolbar: two rows of symbol palettes
// (flat grids of glyphs) above a row of template palettes (structures with holes),
// then a tabbed bar of ready-made expressions.
//
// Coverage is designed to match what MathType 7 offers — every command accessible
// via a palette in the desktop app should be findable here in the same place.
//
// Every entry inserts LaTeX. `#?` is MathLive's placeholder token: after insertion the
// caret lands on the first one and Tab moves between the rest.

export interface MathItem {
  /** What the button shows. Rendered as LaTeX when `render` is set, otherwise literally. */
  label: string;
  /** LaTeX inserted at the caret. `#?` marks a placeholder. */
  tex: string;
  /** Tooltip. */
  name?: string;
  /** Render the label with KaTeX rather than showing it as plain text. */
  render?: boolean;
}

export interface MathGroup {
  name: string;
  /** Toolbar button face — a representative glyph, as in MathType. */
  icon: string;
  items: MathItem[];
  /** Columns in the dropdown grid. Symbol palettes are dense, templates vary. */
  cols?: number;
}

const g = (label: string, tex: string, name?: string): MathItem => ({ label, tex, name });
const t = (label: string, tex: string, name?: string): MathItem => ({ label, tex, name, render: true });

// ===========================================================================
// Keyboard shortcuts
// ===========================================================================

export interface Shortcut {
  /** `KeyboardEvent.key`. Letters are matched case-insensitively. */
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** The template inserted — the same string as the palette item it mirrors. */
  tex: string;
  /** What it inserts, for the tooltip and the Help menu. */
  name: string;
}

/**
 * Shortcuts for the structures people build over and over.
 *
 * Every combination here is one the browser lets a page keep. That rules out the
 * obvious MathType bindings: Ctrl+1…9 switch tabs, Ctrl+T opens one, Ctrl+W closes one,
 * and Ctrl+Shift+I opens devtools — a page cannot preventDefault any of them, so binding
 * a template to one would look like the editor ignoring the key. Ctrl+P and Ctrl+R are
 * preventable, but print and reload are destructive enough when the guard slips that they
 * are not worth the mnemonic.
 *
 * The keys themselves come from MathType where it is safe: Ctrl+/ for a fraction, and
 * Ctrl+↑ / Ctrl+↓ for the scripts, which read as "raise this" and "lower this".
 */
export const SHORTCUTS: Shortcut[] = [
  { key: "/", ctrl: true, tex: "\\frac{#?}{#?}", name: "Fraction" },
  { key: "/", ctrl: true, shift: true, tex: "#?/#?", name: "Slash fraction" },
  { key: "ArrowUp", ctrl: true, tex: "^{#?}", name: "Superscript" },
  { key: "ArrowDown", ctrl: true, tex: "_{#?}", name: "Subscript" },
  { key: "ArrowUp", ctrl: true, shift: true, tex: "\\overset{#?}{#?}", name: "Over" },
  { key: "ArrowDown", ctrl: true, shift: true, tex: "\\underset{#?}{#?}", name: "Under" },
  { key: "\\", ctrl: true, tex: "\\sqrt{#?}", name: "Square root" },
  { key: "\\", ctrl: true, shift: true, tex: "\\sqrt[#?]{#?}", name: "Nth root" },
  { key: "[", ctrl: true, tex: "\\left[#?\\right]", name: "Brackets" },
  { key: "{", ctrl: true, shift: true, tex: "\\left\\{#?\\right\\}", name: "Braces" },
  { key: "9", alt: true, tex: "\\left(#?\\right)", name: "Parentheses" },
  { key: "a", ctrl: true, shift: true, tex: "\\left|#?\\right|", name: "Absolute value" },
  { key: "s", alt: true, tex: "\\sum_{#?}^{#?}#?", name: "Summation" },
  { key: "p", alt: true, tex: "\\prod_{#?}^{#?}#?", name: "Product" },
  { key: "i", alt: true, tex: "\\int #?\\,d#?", name: "Integral" },
  { key: "d", alt: true, tex: "\\int_{#?}^{#?}#?\\,d#?", name: "Definite integral" },
  { key: "l", alt: true, tex: "\\lim_{#?\\to #?}#?", name: "Limit" },
  { key: "b", ctrl: true, tex: "\\mathbf{#?}", name: "Bold" },
  { key: "i", ctrl: true, tex: "\\mathit{#?}", name: "Italic" },
  { key: "e", ctrl: true, shift: true, tex: "\\text{#?}", name: "Text mode" },
];

/** "Ctrl+Shift+↑" — the form shown in tooltips and menus. */
export function shortcutLabel(s: Shortcut): string {
  const parts: string[] = [];
  if (s.ctrl) parts.push("Ctrl");
  if (s.alt) parts.push("Alt");
  if (s.shift) parts.push("Shift");
  const pretty: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
  parts.push(pretty[s.key] ?? (s.key.length === 1 ? s.key.toUpperCase() : s.key));
  return parts.join("+");
}

/** Tooltip lookup, so a palette button can advertise the key that also inserts it. */
export const SHORTCUT_BY_TEX: Map<string, string> = new Map(
  SHORTCUTS.map((s) => [s.tex, shortcutLabel(s)]),
);

/**
 * The template a key event asks for, or null.
 *
 * Modifiers are compared exactly — otherwise Ctrl+Shift+/ would also fire the plain
 * Ctrl+/ binding, and the more specific shortcut could never be reached. Ctrl and Cmd are
 * treated as the same modifier so the bindings work unchanged on a Mac.
 */
export function matchShortcut(e: KeyboardEvent): Shortcut | null {
  const ctrl = e.ctrlKey || e.metaKey;
  for (const s of SHORTCUTS) {
    if (ctrl !== !!s.ctrl || e.altKey !== !!s.alt) continue;
    // `{` and `}` already carry Shift on most layouts, so the event reports the shifted
    // character and demanding shiftKey as well would make the binding unreachable.
    const keyIsShifted = s.key.length === 1 && s.key !== s.key.toLowerCase();
    if (!keyIsShifted && e.shiftKey !== !!s.shift) continue;
    if (e.key.toLowerCase() === s.key.toLowerCase()) return s;
  }
  return null;
}

// ===========================================================================
// Row 1 — symbol palettes (flat glyph grids)
// ===========================================================================

export const SYMBOL_GROUPS: MathGroup[] = [
  // ── Relations ──────────────────────────────────────────────────────────
  {
    name: "Relations",
    icon: "=≠≈",
    cols: 8,
    items: [
      g("=", "="), g("≠", "\\neq"), g("≈", "\\approx"), g("≡", "\\equiv"),
      g("≅", "\\cong"), g("∼", "\\sim"), g("≃", "\\simeq"), g("≍", "\\asymp"),
      g("<", "<"), g(">", ">"), g("≤", "\\leq"), g("≥", "\\geq"),
      g("≪", "\\ll"), g("≫", "\\gg"), g("≺", "\\prec"), g("≻", "\\succ"),
      g("⪯", "\\preceq"), g("⪰", "\\succeq"), g("≼", "\\preccurlyeq"), g("≽", "\\succcurlyeq"),
      g("⋘", "\\lll"), g("⋙", "\\ggg"), g("∝", "\\propto"), g("≐", "\\doteq"),
      g("≑", "\\doteqdot"), g("≓", "\\risingdotseq"), g("≖", "\\eqcirc"), g("≗", "\\circeq"),
      g("⊨", "\\vDash"), g("⊨", "\\models"), g("⊩", "\\Vdash"), g("⊪", "\\Vvdash"),
      g("≈", "\\thickapprox"), g("∼", "\\thicksim"), g("⫅", "\\subseteqq"), g("⫆", "\\supseteqq"),
      g("≬", "\\between"), g("⋔", "\\pitchfork"), g("∥", "\\parallel"), g("∦", "\\nparallel"),
      g("⊥", "\\perp"), g("⋈", "\\bowtie"), g("⋉", "\\ltimes"), g("⋊", "\\rtimes"),
      g("≊", "\\approxeq"), g("⪅", "\\lessapprox"), g("⪆", "\\gtrapprox"), g("≂", "\\eqsim"),
      g("←", "\\sqsubset"), g("⊐", "\\sqsupset"), g("⊑", "\\sqsubseteq"), g("⊒", "\\sqsupseteq"),
    ],
  },

  // ── Negated Relations ──────────────────────────────────────────────────
  {
    name: "Negated",
    icon: "≠∉",
    cols: 8,
    items: [
      g("≠", "\\neq"), g("≮", "\\nless"), g("≯", "\\ngtr"), g("≰", "\\nleq"),
      g("≱", "\\ngeq"), g("≨", "\\lneq"), g("≩", "\\gneq"), g("≨", "\\lneqq"),
      g("≩", "\\gneqq"), g("≨", "\\lvertneqq"), g("≩", "\\gvertneqq"), g("⪈", "\\gnapprox"),
      g("∉", "\\notin"), g("∌", "\\notni"), g("⊄", "\\not\\subset"), g("⊅", "\\not\\supset"),
      g("⊈", "\\nsubseteq"), g("⊉", "\\nsupseteq"), g("⊊", "\\subsetneq"), g("⊋", "\\supsetneq"),
      g("⊄", "\\nsubseteqq"), g("≢", "\\not\\equiv"), g("≇", "\\ncong"),
      g("≉", "\\not\\approx"), g("∤", "\\nmid"), g("∦", "\\nparallel"), g("⋪", "\\ntriangleleft"),
      g("⋫", "\\ntriangleright"), g("⋬", "\\ntrianglelefteq"), g("⋭", "\\ntrianglerighteq"), g("⇍", "\\nLeftarrow"),
      g("⇏", "\\nRightarrow"), g("⇎", "\\nLeftrightarrow"), g("∉", "\\not\\ni"), g("⊬", "\\nvdash"),
      g("⊮", "\\nVDash"), g("⊭", "\\nvDash"), g("⊯", "\\nVdash"), g("≁", "\\nsim"),
    ],
  },

  // ── Operators ──────────────────────────────────────────────────────────
  {
    name: "Operators",
    icon: "±∙⊗",
    cols: 8,
    items: [
      g("+", "+"), g("−", "-"), g("±", "\\pm"), g("∓", "\\mp"),
      g("×", "\\times"), g("÷", "\\div"), g("·", "\\cdot"), g("∗", "\\ast"),
      g("⋆", "\\star"), g("∘", "\\circ"), g("•", "\\bullet"), g("⊕", "\\oplus"),
      g("⊖", "\\ominus"), g("⊗", "\\otimes"), g("⊘", "\\oslash"), g("⊙", "\\odot"),
      g("⊚", "\\circledcirc"), g("⊛", "\\circledast"), g("⊝", "\\circleddash"), g("⊞", "\\boxplus"),
      g("⊟", "\\boxminus"), g("⊠", "\\boxtimes"), g("⊡", "\\boxdot"), g("⋄", "\\diamond"),
      g("∧", "\\wedge"), g("∨", "\\vee"), g("∩", "\\cap"), g("∪", "\\cup"),
      g("⊎", "\\uplus"), g("⊓", "\\sqcap"), g("⊔", "\\sqcup"), g("△", "\\bigtriangleup"),
      g("▽", "\\bigtriangledown"), g("◁", "\\triangleleft"), g("▷", "\\triangleright"), g("▲", "\\blacktriangle"),
      g("▼", "\\blacktriangledown"), g("◀", "\\blacktriangleleft"), g("▶", "\\blacktriangleright"), g("†", "\\dagger"),
      g("‡", "\\ddagger"), g("≀", "\\wr"), g("⨿", "\\amalg"), g("⋁", "\\bigvee"),
      g("⋀", "\\bigwedge"), g("⨄", "\\biguplus"), g("⨆", "\\bigsqcup"), g("⊍", "\\dotplus"),
      g("⫝", "\\smallsetminus"), g("⋒", "\\Cap"), g("⋓", "\\Cup"), g("⋇", "\\divideontimes"),
      g("∯", "\\oiint"), g("∰", "\\oiiint"), g("⊼", "\\barwedge"), g("⊻", "\\veebar"),
      g("⩗", "\\intercal"), g("∖", "\\setminus"),
    ],
  },

  // ── Spaces & Ellipses ──────────────────────────────────────────────────
  {
    name: "Spaces & Ellipses",
    icon: "⋯",
    cols: 6,
    items: [
      g("…", "\\ldots"), g("⋯", "\\cdots"), g("⋮", "\\vdots"), g("⋱", "\\ddots"),
      g("⋯", "\\dotsm", "Product dots"), g("∴", "\\therefore"), g("∵", "\\because"), g("∶", "\\ratio"),
      g("⫶", "\\colon"), g("—", "---", "Em dash"), g("–", "--", "En dash"),
      g("thin", "\\,", "Thin space"), g("med", "\\:", "Medium space"),
      g("thick", "\\;", "Thick space"), g("quad", "\\quad", "Quad space"),
      g("qquad", "\\qquad", "Double quad"), g("neg", "\\!", "Negative thin space"),
    ],
  },

  // ── Embellishments ─────────────────────────────────────────────────────
  {
    name: "Embellishments",
    icon: "x̄",
    cols: 6,
    items: [
      t("\\hat{x}", "\\hat{#?}", "Hat"), t("\\check{x}", "\\check{#?}", "Check"),
      t("\\tilde{x}", "\\tilde{#?}", "Tilde"), t("\\acute{x}", "\\acute{#?}", "Acute"),
      t("\\grave{x}", "\\grave{#?}", "Grave"), t("\\dot{x}", "\\dot{#?}", "Dot"),
      t("\\ddot{x}", "\\ddot{#?}", "Double dot"), t("\\dddot{x}", "\\dddot{#?}", "Triple dot"),
      t("\\breve{x}", "\\breve{#?}", "Breve"), t("\\bar{x}", "\\bar{#?}", "Bar"),
      t("\\vec{x}", "\\vec{#?}", "Vector"), t("\\mathring{x}", "\\mathring{#?}", "Ring"),
      t("\\widehat{xy}", "\\widehat{#?}", "Wide hat"), t("\\widetilde{xy}", "\\widetilde{#?}", "Wide tilde"),
      t("\\overline{xy}", "\\overline{#?}", "Overline"), t("\\underline{xy}", "\\underline{#?}", "Underline"),
      t("\\overrightarrow{xy}", "\\overrightarrow{#?}", "Over right arrow"),
      t("\\overleftarrow{xy}", "\\overleftarrow{#?}", "Over left arrow"),
      t("\\overbrace{xy}", "\\overbrace{#?}", "Over brace"), t("\\underbrace{xy}", "\\underbrace{#?}", "Under brace"),
      t("\\overset{a}{x}", "\\overset{#?}{#?}", "Overset"), t("\\underset{a}{x}", "\\underset{#?}{#?}", "Underset"),
      t("\\xrightarrow{f}", "\\xrightarrow{#?}", "Labeled right arrow"),
      t("\\xleftarrow{f}", "\\xleftarrow{#?}", "Labeled left arrow"),
    ],
  },

  // ── Arrows ─────────────────────────────────────────────────────────────
  {
    name: "Arrows",
    icon: "→⇔",
    cols: 6,
    items: [
      g("←", "\\leftarrow"), g("→", "\\rightarrow"), g("↔", "\\leftrightarrow"),
      g("⇐", "\\Leftarrow"), g("⇒", "\\Rightarrow"), g("⇔", "\\Leftrightarrow"),
      g("↑", "\\uparrow"), g("↓", "\\downarrow"), g("↕", "\\updownarrow"),
      g("⇑", "\\Uparrow"), g("⇓", "\\Downarrow"), g("⇕", "\\Updownarrow"),
      g("↦", "\\mapsto"), g("⟼", "\\longmapsto"), g("⟵", "\\longleftarrow"),
      g("⟶", "\\longrightarrow"), g("⟷", "\\longleftrightarrow"), g("⟹", "\\Longrightarrow"),
      g("⟸", "\\Longleftarrow"), g("⟺", "\\Longleftrightarrow"),
      g("↗", "\\nearrow"), g("↘", "\\searrow"), g("↙", "\\swarrow"), g("↖", "\\nwarrow"),
      g("↝", "\\rightsquigarrow"), g("↝", "\\leadsto"), g("⇌", "\\rightleftharpoons"),
      g("↼", "\\leftharpoonup"), g("⇀", "\\rightharpoonup"), g("↽", "\\leftharpoondown"),
      g("⇁", "\\rightharpoondown"), g("↪", "\\hookrightarrow"), g("↩", "\\hookleftarrow"),
      g("⇜", "\\leftrightsquigarrow"), g("↿", "\\upharpoonleft"),
      g("↾", "\\upharpoonright"), g("⇃", "\\downharpoonleft"), g("⇂", "\\downharpoonright"),
      g("⇉", "\\rightrightarrows"), g("⇇", "\\leftleftarrows"), g("⇆", "\\leftrightarrows"),
      g("⇄", "\\rightleftarrows"), g("⇋", "\\leftrightharpoons"), g("↰", "\\Lsh"), g("↱", "\\Rsh"),
      g("⇈", "\\upuparrows"), g("⇊", "\\downdownarrows"), g("↺", "\\circlearrowleft"), g("↻", "\\circlearrowright"),
      g("↶", "\\curvearrowleft"), g("↷", "\\curvearrowright"), g("⇚", "\\Lleftarrow"), g("⇛", "\\Rrightarrow"),
    ],
  },

  // ── Logic ──────────────────────────────────────────────────────────────
  {
    name: "Logic",
    icon: "∀∃",
    cols: 6,
    items: [
      g("∀", "\\forall"), g("∃", "\\exists"), g("∄", "\\nexists"),
      g("¬", "\\neg"), g("∼", "\\sim", "Not"), g("∧", "\\land"),
      g("∨", "\\lor"), g("→", "\\to"), g("⇒", "\\implies"),
      g("⇔", "\\iff"), g("↔", "\\leftrightarrow"), g("⊢", "\\vdash"),
      g("⊣", "\\dashv"), g("⊨", "\\models"), g("⊤", "\\top"),
      g("⊥", "\\bot"), g("∴", "\\therefore"), g("∵", "\\because"),
      g("∎", "\\blacksquare"), g("□", "\\square"), g("◊", "\\lozenge"),
      g("◇", "\\Diamond"), g("⋄", "\\diamond"), g("∅", "\\emptyset"),
      g("∁", "\\complement"), g("⊼", "\\barwedge"), g("⊻", "\\veebar"),
      g("∥", "\\parallel"), g("∦", "\\nmid"), g("∣", "\\mid"),
    ],
  },

  // ── Set Theory ─────────────────────────────────────────────────────────
  {
    name: "Set Theory",
    icon: "∈⊂",
    cols: 6,
    items: [
      g("∈", "\\in"), g("∉", "\\notin"), g("∋", "\\ni"),
      g("⊂", "\\subset"), g("⊃", "\\supset"), g("⊆", "\\subseteq"),
      g("⊇", "\\supseteq"), g("⊄", "\\not\\subset"), g("⊊", "\\subsetneq"),
      g("⊋", "\\supsetneq"), g("∪", "\\cup"), g("∩", "\\cap"),
      g("∖", "\\setminus"), g("△", "\\triangle", "Symmetric diff"), g("∅", "\\varnothing"),
      g("℘", "\\wp"), g("∁", "\\complement"), g("⊔", "\\sqcup"),
      g("ℕ", "\\mathbb{N}"), g("ℤ", "\\mathbb{Z}"), g("ℚ", "\\mathbb{Q}"),
      g("ℝ", "\\mathbb{R}"), g("ℂ", "\\mathbb{C}"), g("𝔽", "\\mathbb{F}"),
      g("ℙ", "\\mathbb{P}"), g("ℍ", "\\mathbb{H}"), g("𝕆", "\\mathbb{O}"),
      g("⋃", "\\bigcup"), g("⋂", "\\bigcap"), g("⨆", "\\bigsqcup"),
      g("⨄", "\\biguplus"), g("⨀", "\\bigodot"), g("⊍", "\\dotplus"),
    ],
  },

  // ── Miscellaneous ──────────────────────────────────────────────────────
  {
    name: "Miscellaneous",
    icon: "∂∞",
    cols: 6,
    items: [
      g("∂", "\\partial"), g("∞", "\\infty"), g("ℓ", "\\ell"),
      g("∇", "\\nabla"), g("ℏ", "\\hbar"), g("ı", "\\imath"),
      g("ȷ", "\\jmath"), g("ℜ", "\\Re"), g("ℑ", "\\Im"),
      g("ℵ", "\\aleph"), g("ℶ", "\\beth"), g("ℷ", "\\gimel"),
      g("°", "^\\circ"), g("′", "'"), g("″", "''"),
      g("‴", "'''"), g("∠", "\\angle"), g("∡", "\\measuredangle"),
      g("∢", "\\sphericalangle"), g("∥", "\\|"), g("∣", "\\mid"),
      g("†", "\\dagger"), g("‡", "\\ddagger"), g("§", "\\S"),
      g("¶", "\\P"), g("©", "\\copyright"), g("®", "\\circledR"),
      g("✓", "\\checkmark"), g("♯", "\\sharp"), g("♭", "\\flat"),
      g("♮", "\\natural"), g("Ⅎ", "\\Finv"), g("℧", "\\mho"),
      g("✠", "\\maltese"), g("⅁", "\\Game"),
    ],
  },

  // ── Greek (lower) ──────────────────────────────────────────────────────
  {
    name: "Greek (lower)",
    icon: "αβγ",
    cols: 8,
    items: [
      g("α", "\\alpha"), g("β", "\\beta"), g("γ", "\\gamma"), g("δ", "\\delta"),
      g("ε", "\\epsilon"), g("ϵ", "\\varepsilon"), g("ζ", "\\zeta"), g("η", "\\eta"),
      g("θ", "\\theta"), g("ϑ", "\\vartheta"), g("ι", "\\iota"), g("κ", "\\kappa"),
      g("κ", "\\varkappa"), g("λ", "\\lambda"), g("μ", "\\mu"), g("ν", "\\nu"),
      g("ξ", "\\xi"), g("π", "\\pi"), g("ϖ", "\\varpi"), g("ρ", "\\rho"),
      g("ϱ", "\\varrho"), g("σ", "\\sigma"), g("ς", "\\varsigma"), g("τ", "\\tau"),
      g("υ", "\\upsilon"), g("φ", "\\phi"), g("ϕ", "\\varphi"), g("χ", "\\chi"),
      g("ψ", "\\psi"), g("ω", "\\omega"), g("ϝ", "\\digamma"),
    ],
  },

  // ── Greek (upper) ──────────────────────────────────────────────────────
  {
    name: "Greek (upper)",
    icon: "ΔΩ",
    cols: 6,
    items: [
      g("Γ", "\\Gamma"), g("Δ", "\\Delta"), g("Θ", "\\Theta"),
      g("Λ", "\\Lambda"), g("Ξ", "\\Xi"), g("Π", "\\Pi"),
      g("Σ", "\\Sigma"), g("Υ", "\\Upsilon"), g("Φ", "\\Phi"),
      g("Ψ", "\\Psi"), g("Ω", "\\Omega"), g("𝛤", "\\varGamma", "Italic Gamma"),
    ],
  },
];

// ===========================================================================
// Row 2 — template palettes (structures with placeholders)
// ===========================================================================

export const TEMPLATE_GROUPS: MathGroup[] = [
  // ── Fences ─────────────────────────────────────────────────────────────
  {
    name: "Fences",
    icon: "()",
    cols: 4,
    items: [
      t("(x)", "\\left(#?\\right)", "Parentheses"),
      t("[x]", "\\left[#?\\right]", "Brackets"),
      t("\\{x\\}", "\\left\\{#?\\right\\}", "Braces"),
      t("\\langle x\\rangle", "\\left\\langle #?\\right\\rangle", "Angle brackets"),
      t("|x|", "\\left|#?\\right|", "Absolute value"),
      t("\\|x\\|", "\\left\\|#?\\right\\|", "Norm"),
      t("\\lfloor x\\rfloor", "\\left\\lfloor #?\\right\\rfloor", "Floor"),
      t("\\lceil x\\rceil", "\\left\\lceil #?\\right\\rceil", "Ceiling"),
      t("\\ulcorner x\\urcorner", "\\ulcorner #?\\urcorner", "Upper corner"),
      t("\\llcorner x\\lrcorner", "\\llcorner #?\\lrcorner", "Lower corner"),
      t("(x,y)", "\\left(#?,#?\\right)", "Ordered pair"),
      t("(x;y)", "\\left(#?;#?\\right)", "Tuple with semicolon"),
      t("\\binom{n}{k}", "\\binom{#?}{#?}", "Binomial coefficient"),
      t("\\left.x\\right|", "\\left.#?\\right|_{#?}", "Evaluated at"),
      t("\\left.x\\right|_{a}^{b}", "\\left.#?\\right|_{#?}^{#?}", "Evaluated, limits"),
      t("\\{x:y\\}", "\\left\\{#?\\;:\\;#?\\right\\}", "Set builder"),
    ],
  },

  // ── Fractions & Radicals ───────────────────────────────────────────────
  {
    name: "Fractions & Radicals",
    icon: "½√",
    cols: 4,
    items: [
      t("\\frac{a}{b}", "\\frac{#?}{#?}", "Fraction"),
      t("\\tfrac{a}{b}", "\\tfrac{#?}{#?}", "Small fraction"),
      t("\\dfrac{a}{b}", "\\dfrac{#?}{#?}", "Display fraction"),
      t("a/b", "#?/#?", "Slash fraction"),
      t("\\cfrac{a}{b}", "\\cfrac{#?}{#?}", "Continued fraction"),
      t("\\sqrt{x}", "\\sqrt{#?}", "Square root"),
      t("\\sqrt[n]{x}", "\\sqrt[#?]{#?}", "Nth root"),
      t("\\sqrt[3]{x}", "\\sqrt[3]{#?}", "Cube root"),
      t("\\frac{\\partial a}{\\partial b}", "\\frac{\\partial #?}{\\partial #?}", "Partial derivative"),
      t("\\frac{dy}{dx}", "\\frac{dy}{dx}", "dy/dx"),
      t("\\frac{d^2y}{dx^2}", "\\frac{d^{2}y}{dx^{2}}", "Second derivative"),
      t("\\frac{\\Delta y}{\\Delta x}", "\\frac{\\Delta #?}{\\Delta #?}", "Difference quotient"),
    ],
  },

  // ── Scripts ────────────────────────────────────────────────────────────
  {
    name: "Scripts",
    icon: "xⁿ",
    cols: 4,
    items: [
      // Bare scripts, so they attach to whatever precedes the caret — and so a
      // selection lands in the exponent rather than the base. Select the `2` of `a2`,
      // click this, and you get `a^2`, which is what MathType does and what the
      // gesture obviously means.
      t("x^{n}", "^{#?}", "Superscript"),
      t("x_{n}", "_{#?}", "Subscript"),
      t("x_{a}^{b}", "_{#?}^{#?}", "Sub and superscript"),
      t("x^{n}", "#?^{#?}", "Base and superscript"),
      t("x_{n}", "#?_{#?}", "Base and subscript"),
      t("^{a}x", "{}^{#?}#?", "Left superscript"),
      t("{}_{a}x", "{}_{#?}#?", "Left subscript"),
      t("{}_{a}^{b}x", "{}_{#?}^{#?}#?", "Left sub + superscript"),
      t("x'", "#?'", "Prime"),
      t("x''", "#?''", "Double prime"),
      t("\\overset{a}{b}", "\\overset{#?}{#?}", "Over"),
      t("\\underset{a}{b}", "\\underset{#?}{#?}", "Under"),
      t("{}_a^b X_c^d", "{}_{#?}^{#?}#?_{#?}^{#?}", "Multi-index"),
      t("x\\degree", "#?^\\circ", "Degrees"),
    ],
  },

  // ── Summations ─────────────────────────────────────────────────────────
  {
    name: "Summations",
    icon: "ΣΠ",
    cols: 3,
    items: [
      t("\\sum_{i}^{n}", "\\sum_{#?}^{#?}#?", "Summation"),
      t("\\sum_{i=1}^{n}", "\\sum_{i=1}^{n}#?", "Sum 1..n"),
      t("\\sum_{i=1}^{\\infty}", "\\sum_{i=1}^{\\infty}#?", "Infinite sum"),
      t("\\prod_{i}^{n}", "\\prod_{#?}^{#?}#?", "Product"),
      t("\\prod_{i=1}^{n}", "\\prod_{i=1}^{n}#?", "Product 1..n"),
      t("\\coprod_{i}^{n}", "\\coprod_{#?}^{#?}#?", "Coproduct"),
      t("\\bigcup_{i}^{n}", "\\bigcup_{#?}^{#?}#?", "Big union"),
      t("\\bigcup_{i=1}^{n}", "\\bigcup_{i=1}^{n}#?", "Big union 1..n"),
      t("\\bigcap_{i}^{n}", "\\bigcap_{#?}^{#?}#?", "Big intersection"),
      t("\\bigcap_{i=1}^{n}", "\\bigcap_{i=1}^{n}#?", "Big intersection 1..n"),
      t("\\bigoplus_{i}^{n}", "\\bigoplus_{#?}^{#?}#?", "Big oplus"),
      t("\\bigotimes_{i}^{n}", "\\bigotimes_{#?}^{#?}#?", "Big otimes"),
      t("\\bigwedge_{i}^{n}", "\\bigwedge_{#?}^{#?}#?", "Big wedge"),
      t("\\bigvee_{i}^{n}", "\\bigvee_{#?}^{#?}#?", "Big vee"),
      t("\\bigsqcup_{i}^{n}", "\\bigsqcup_{#?}^{#?}#?", "Big sqcup"),
    ],
  },

  // ── Integrals ──────────────────────────────────────────────────────────
  {
    name: "Integrals",
    icon: "∫∮",
    cols: 3,
    items: [
      t("\\int", "\\int #?\\,d#?", "Integral"),
      t("\\int_{a}^{b}", "\\int_{#?}^{#?}#?\\,d#?", "Definite integral"),
      t("\\int_{-\\infty}^{\\infty}", "\\int_{-\\infty}^{\\infty}#?\\,d#?", "Over the reals"),
      t("\\iint", "\\iint #?\\,d#?", "Double integral"),
      t("\\iint_D", "\\iint_{#?}#?\\,dA", "Double over region"),
      t("\\iiint", "\\iiint #?\\,d#?", "Triple integral"),
      t("\\iiint_E", "\\iiint_{#?}#?\\,dV", "Triple over region"),
      t("\\int\\!\\!\\!\\iiint", "\\int\\!\\!\\!\\iiint #?", "Quadruple integral"),
      t("\\oint", "\\oint #?\\,d#?", "Contour integral"),
      t("\\oiint", "\\oiint #?\\,d#?", "Surface integral"),
      t("\\oiiint", "\\oiiint #?", "Volume integral"),
      t("\\int\\cdots\\int", "\\int\\cdots\\int #?", "Multiple integral"),
      t("\\lim_{x\\to a}", "\\lim_{#?\\to #?}#?", "Limit"),
      t("\\lim_{x\\to a^{+}}", "\\lim_{#?\\to #?^{+}}#?", "Limit from right"),
      t("\\lim_{x\\to a^{-}}", "\\lim_{#?\\to #?^{-}}#?", "Limit from left"),
      t("\\lim_{n\\to\\infty}", "\\lim_{n\\to\\infty}#?", "Limit to infinity"),
      t("\\liminf_{n\\to\\infty}", "\\liminf_{n\\to\\infty}#?", "Limit inferior"),
      t("\\limsup_{n\\to\\infty}", "\\limsup_{n\\to\\infty}#?", "Limit superior"),
    ],
  },

  // ── Bars & Braces ──────────────────────────────────────────────────────
  {
    name: "Bars & Braces",
    icon: "⏞",
    cols: 3,
    items: [
      t("\\overline{xy}", "\\overline{#?}", "Overbar"),
      t("\\underline{xy}", "\\underline{#?}", "Underbar"),
      t("\\overbrace{xy}", "\\overbrace{#?}^{#?}", "Overbrace"),
      t("\\underbrace{xy}", "\\underbrace{#?}_{#?}", "Underbrace"),
      t("\\overgroup{xy}", "\\overgroup{#?}", "Over group"),
      t("\\undergroup{xy}", "\\undergroup{#?}", "Under group"),
      t("\\overlinesegment{xy}", "\\overlinesegment{#?}", "Over segment"),
      t("\\underlinesegment{xy}", "\\underlinesegment{#?}", "Under segment"),
      t("\\boxed{x}", "\\boxed{#?}", "Boxed"),
      t("\\cancel{x}", "\\cancel{#?}", "Cancel"),
      t("\\bcancel{xy}", "\\bcancel{#?}", "Back cancel"),
      t("\\xcancel{xy}", "\\xcancel{#?}", "Cross cancel"),
    ],
  },

  // ── Labeled Arrows ─────────────────────────────────────────────────────
  {
    name: "Labeled Arrows",
    icon: "⟶",
    cols: 2,
    items: [
      t("\\xrightarrow{f}", "\\xrightarrow{#?}", "Labeled right arrow"),
      t("\\xrightarrow[g]{f}", "\\xrightarrow[#?]{#?}", "Arrow, both labels"),
      t("\\xleftarrow{f}", "\\xleftarrow{#?}", "Labeled left arrow"),
      t("\\xleftarrow[g]{f}", "\\xleftarrow[#?]{#?}", "Left arrow, both labels"),
      t("\\xRightarrow{f}", "\\xRightarrow{#?}", "Labeled implies"),
      t("\\xLeftarrow{f}", "\\xLeftarrow{#?}", "Labeled left implies"),
      t("\\xleftrightarrow{f}", "\\xleftrightarrow{#?}", "Labeled bi-arrow"),
      t("\\xLeftrightarrow{f}", "\\xLeftrightarrow{#?}", "Labeled bi-implies"),
      t("\\xhookrightarrow{f}", "\\xhookrightarrow{#?}", "Labeled hook right"),
      t("\\xhookleftarrow{f}", "\\xhookleftarrow{#?}", "Labeled hook left"),
      t("\\xmapsto{f}", "\\xmapsto{#?}", "Labeled mapsto"),
      t("\\xrightharpoonup{f}", "\\xrightharpoonup{#?}", "Labeled harpoon up"),
      t("\\xrightharpoondown{f}", "\\xrightharpoondown{#?}", "Labeled harpoon down"),
      t("\\xleftharpoonup{f}", "\\xleftharpoonup{#?}", "Labeled left harpoon up"),
      t("\\xleftharpoondown{f}", "\\xleftharpoondown{#?}", "Labeled left harpoon down"),
      t("\\xtwoheadrightarrow{f}", "\\xtwoheadrightarrow{#?}", "Labeled two-head right"),
      t("\\xtwoheadleftarrow{f}", "\\xtwoheadleftarrow{#?}", "Labeled two-head left"),
    ],
  },

  // ── Matrices ───────────────────────────────────────────────────────────
  {
    name: "Matrices",
    icon: "▦",
    cols: 2,
    items: [
      // Bracketless first: a matrix template should give you a grid, and let you say
      // which fence you want — not decide on parentheses for you.
      t("\\begin{matrix}a&b\\\\c&d\\end{matrix}", "\\begin{matrix}#?&#?\\\\#?&#?\\end{matrix}", "2×2 matrix, no brackets"),
      t("\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}", "\\begin{pmatrix}#?&#?\\\\#?&#?\\end{pmatrix}", "2×2 parenthesis matrix"),
      t("\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}", "\\begin{bmatrix}#?&#?\\\\#?&#?\\end{bmatrix}", "2×2 bracket matrix"),
      t("\\begin{Bmatrix}a&b\\\\c&d\\end{Bmatrix}", "\\begin{Bmatrix}#?&#?\\\\#?&#?\\end{Bmatrix}", "Brace matrix"),
      t("\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}", "\\begin{vmatrix}#?&#?\\\\#?&#?\\end{vmatrix}", "Determinant"),
      t("\\begin{Vmatrix}a&b\\\\c&d\\end{Vmatrix}", "\\begin{Vmatrix}#?&#?\\\\#?&#?\\end{Vmatrix}", "Norm matrix"),
      t("\\begin{pmatrix}a\\\\b\\end{pmatrix}", "\\begin{pmatrix}#?\\\\#?\\end{pmatrix}", "Column vector"),
      t("\\begin{pmatrix}a&b&c\\end{pmatrix}", "\\begin{pmatrix}#?&#?&#?\\end{pmatrix}", "Row vector"),
      t("\\begin{pmatrix}a&b&c\\\\d&e&f\\\\g&h&i\\end{pmatrix}", "\\begin{pmatrix}#?&#?&#?\\\\#?&#?&#?\\\\#?&#?&#?\\end{pmatrix}", "3×3 matrix"),
      t("\\begin{pmatrix}a&\\cdots&b\\\\\\vdots&\\ddots&\\vdots\\\\c&\\cdots&d\\end{pmatrix}", "\\begin{pmatrix}#?&\\cdots&#?\\\\\\vdots&\\ddots&\\vdots\\\\#?&\\cdots&#?\\end{pmatrix}", "Matrix with ellipses"),
      t("\\begin{cases}a&x<0\\\\b&x\\ge0\\end{cases}", "\\begin{cases}#?&\\text{if }#?\\\\#?&\\text{otherwise}\\end{cases}", "Cases"),
      t("\\begin{dcases}a&x<0\\\\b&x\\ge0\\end{dcases}", "\\begin{dcases}#?&\\\\#?&\\end{dcases}", "Display cases"),
      t("\\begin{aligned}a&=b\\\\&=c\\end{aligned}", "\\begin{aligned}#?&=#?\\\\&=#?\\end{aligned}", "Aligned equations"),
      t("\\begin{gathered}a=b\\\\c=d\\end{gathered}", "\\begin{gathered}#?\\\\#?\\end{gathered}", "Gathered lines"),
      t("\\begin{aligned}a&=b\\\\c&=d\\end{aligned}", "\\begin{aligned}#?&=#?\\\\#?&=#?\\end{aligned}", "Aligned pair"),
      t("\\begin{array}{c|c}a&b\\\\\\hline c&d\\end{array}", "\\begin{array}{c|c}#?&#?\\\\\\hline #?&#?\\end{array}", "Ruled array"),
      t("\\begin{array}{ccc}a&b&c\\\\d&e&f\\end{array}", "\\begin{array}{ccc}#?&#?&#?\\\\#?&#?&#?\\end{array}", "3-column array"),
    ],
  },

  // ── Functions ──────────────────────────────────────────────────────────
  {
    name: "Functions",
    icon: "ƒ",
    cols: 5,
    items: [
      g("sin", "\\sin"), g("cos", "\\cos"), g("tan", "\\tan"),
      g("csc", "\\csc"), g("sec", "\\sec"), g("cot", "\\cot"),
      g("arcsin", "\\arcsin"), g("arccos", "\\arccos"), g("arctan", "\\arctan"),
      g("sinh", "\\sinh"), g("cosh", "\\cosh"), g("tanh", "\\tanh"),
      g("csch", "\\operatorname{csch}"), g("sech", "\\operatorname{sech}"), g("coth", "\\coth"),
      g("log", "\\log"), g("ln", "\\ln"), g("lg", "\\lg"),
      g("exp", "\\exp"), g("lim", "\\lim"), g("liminf", "\\liminf"),
      g("limsup", "\\limsup"), g("max", "\\max"), g("min", "\\min"),
      g("sup", "\\sup"), g("inf", "\\inf"), g("det", "\\det"),
      g("dim", "\\dim"), g("ker", "\\ker"), g("deg", "\\deg"),
      g("gcd", "\\gcd"), g("lcm", "\\operatorname{lcm}"), g("Pr", "\\Pr"),
      g("arg", "\\arg"), g("mod", "\\bmod"), g("hom", "\\hom"),
      g("tr", "\\operatorname{tr}"), g("rank", "\\operatorname{rank}"), g("sgn", "\\operatorname{sgn}"),
      g("id", "\\operatorname{id}"), g("dom", "\\operatorname{dom}"), g("ran", "\\operatorname{ran}"),
      g("cov", "\\operatorname{cov}"), g("var", "\\operatorname{var}"), g("std", "\\operatorname{std}"),
      g("erf", "\\operatorname{erf}"), g("erfc", "\\operatorname{erfc}"), g("sinc", "\\operatorname{sinc}"),
    ],
  },

  // ── Font Styles ────────────────────────────────────────────────────────
  {
    name: "Styles",
    icon: "𝔄",
    cols: 3,
    items: [
      t("\\mathbf{A}", "\\mathbf{#?}", "Bold"),
      t("\\mathit{A}", "\\mathit{#?}", "Italic"),
      t("\\mathrm{A}", "\\mathrm{#?}", "Roman"),
      t("\\mathcal{A}", "\\mathcal{#?}", "Calligraphic"),
      t("\\mathscr{A}", "\\mathscr{#?}", "Script"),
      t("\\mathfrak{A}", "\\mathfrak{#?}", "Fraktur"),
      t("\\mathbb{A}", "\\mathbb{#?}", "Blackboard bold"),
      t("\\mathsf{A}", "\\mathsf{#?}", "Sans serif"),
      t("\\mathtt{A}", "\\mathtt{#?}", "Monospace"),
      t("\\text{abc}", "\\text{#?}", "Upright text"),
      t("\\textbf{abc}", "\\textbf{#?}", "Bold text"),
      t("\\textit{abc}", "\\textit{#?}", "Italic text"),
      t("\\textsf{abc}", "\\textsf{#?}", "Sans text"),
      t("\\texttt{abc}", "\\texttt{#?}", "Monospace text"),
      // A three-colour swatch, not a single red glyph. KaTeX draws its own parse errors
      // in red, so a lone red `x` sitting in a palette reads as a broken entry rather
      // than as the colour feature it is.
      t("\\textcolor{#f87171}{a}\\textcolor{#60a5fa}{b}\\textcolor{#4ade80}{c}", "\\textcolor{#f87171}{#?}", "Coloured — red"),
      t("\\textcolor{#60a5fa}{abc}", "\\textcolor{#60a5fa}{#?}", "Coloured — blue"),
      t("\\textcolor{#4ade80}{abc}", "\\textcolor{#4ade80}{#?}", "Coloured — green"),
      t("\\colorbox{#fde68a}{$x$}", "\\colorbox{#fde68a}{$#?$}", "Highlighted"),
    ],
  },
];

// ===========================================================================
// Tabbed bar — MathType's "Algebra / Derivs / …" expression tabs
// ===========================================================================

export interface TemplateTab {
  name: string;
  items: MathItem[];
}

export const TEMPLATE_TABS: TemplateTab[] = [
  {
    name: "Algebra",
    items: [
      t("\\sqrt{a^2+b^2}", "\\sqrt{#?^2+#?^2}", "Hypotenuse"),
      t("\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}", "\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}", "Quadratic formula"),
      t("\\frac{n!}{r!(n-r)!}", "\\frac{n!}{r!\\left(n-r\\right)!}", "Combinations"),
      t("(a+b)^n", "\\left(#?+#?\\right)^{#?}", "Binomial power"),
      t("a^2-b^2=(a+b)(a-b)", "#?^{2}-#?^{2}=\\left(#?+#?\\right)\\left(#?-#?\\right)", "Difference of squares"),
      t("a^3\\pm b^3", "#?^{3}\\pm #?^{3}", "Sum/diff of cubes"),
      t("\\log_b{x}", "\\log_{#?}{#?}", "Logarithm"),
      t("\\ln e^x = x", "\\ln e^{#?}=#?", "Natural log"),
      t("x=\\frac{1}{2}", "#?=\\frac{#?}{#?}", "Equation with fraction"),
      t("|x|", "\\left|#?\\right|", "Absolute value"),
      t("\\sqrt[n]{x}", "\\sqrt[#?]{#?}", "Nth root"),
      t("(x+h)^n \\approx", "\\left(#?+h\\right)^{n}\\approx #?^{n}+n#?^{n-1}h", "Binomial approx"),
    ],
  },
  {
    name: "Derivs",
    items: [
      t("\\frac{dy}{dx}", "\\frac{dy}{dx}", "First derivative"),
      t("\\frac{d^2y}{dx^2}", "\\frac{d^{2}y}{dx^{2}}", "Second derivative"),
      t("\\frac{\\partial f}{\\partial x}", "\\frac{\\partial #?}{\\partial #?}", "Partial derivative"),
      t("\\frac{\\partial^2 f}{\\partial x\\partial y}", "\\frac{\\partial^{2}#?}{\\partial #?\\partial #?}", "Mixed partial"),
      t("\\lim_{h\\to0}\\frac{f(x+h)-f(x)}{h}", "\\lim_{h\\to0}\\frac{f\\left(x+h\\right)-f\\left(x\\right)}{h}", "Derivative definition"),
      t("\\nabla f", "\\nabla #?", "Gradient"),
      t("\\Delta f", "\\Delta #?", "Laplacian"),
      t("\\nabla\\cdot\\vec{F}", "\\nabla\\cdot\\vec{#?}", "Divergence"),
      t("\\nabla\\times\\vec{F}", "\\nabla\\times\\vec{#?}", "Curl"),
      t("\\int_a^b f(x)\\,dx", "\\int_{#?}^{#?}#?\\,dx", "Definite integral"),
      t("\\oint_C F\\cdot dr", "\\oint_{#?}#?\\cdot d#?", "Line integral"),
      t("\\frac{d}{dx}\\int_a^x f(t)\\,dt = f(x)", "\\frac{d}{dx}\\int_{a}^{x}f\\left(t\\right)\\,dt=f\\left(x\\right)", "FTC"),
    ],
  },
  {
    name: "Statistics",
    items: [
      t("\\bar{x}", "\\bar{x}", "Sample mean"),
      t("\\mu", "\\mu", "Population mean"),
      t("\\frac{1}{n}\\sum_{i=1}^{n}x_i", "\\frac{1}{n}\\sum_{i=1}^{n}x_{i}", "Mean formula"),
      t("\\sigma^2", "\\sigma^{2}", "Variance"),
      t("\\sqrt{\\frac{\\sum(x_i-\\bar{x})^2}{n-1}}", "\\sqrt{\\frac{\\sum\\left(x_{i}-\\bar{x}\\right)^{2}}{n-1}}", "Standard deviation"),
      t("P(A|B)=\\frac{P(B|A)P(A)}{P(B)}", "P\\left(A|B\\right)=\\frac{P\\left(B|A\\right)P\\left(A\\right)}{P\\left(B\\right)}", "Bayes' theorem"),
      t("\\binom{n}{k}p^k(1-p)^{n-k}", "\\binom{n}{k}p^{k}\\left(1-p\\right)^{n-k}", "Binomial probability"),
      t("\\mathcal{N}(\\mu,\\sigma^2)", "\\mathcal{N}\\left(\\mu,\\sigma^{2}\\right)", "Normal distribution"),
      t("\\frac{1}{\\sigma\\sqrt{2\\pi}}e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}", "\\frac{1}{\\sigma\\sqrt{2\\pi}}e^{-\\frac{\\left(x-\\mu\\right)^{2}}{2\\sigma^{2}}}", "Normal density"),
      t("Z=\\frac{X-\\mu}{\\sigma}", "Z=\\frac{#?-\\mu}{\\sigma}", "Z-score"),
      t("\\operatorname{Cov}(X,Y)", "\\operatorname{Cov}\\left(#?,#?\\right)", "Covariance"),
      t("\\rho_{X,Y}", "\\rho_{#?,#?}", "Correlation"),
    ],
  },
  {
    name: "Matrices",
    items: [
      t("\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}", "\\begin{pmatrix}#?&#?\\\\#?&#?\\end{pmatrix}", "2×2"),
      t("\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}", "\\begin{bmatrix}#?&#?\\\\#?&#?\\end{bmatrix}", "2×2 brackets"),
      t("\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}", "\\begin{vmatrix}#?&#?\\\\#?&#?\\end{vmatrix}", "Determinant"),
      t("A^{-1}", "#?^{-1}", "Inverse"),
      t("A^{T}", "#?^{T}", "Transpose"),
      t("A^{H}", "#?^{H}", "Conjugate transpose"),
      t("I_n", "I_{#?}", "Identity"),
      t("\\det(A)", "\\det\\left(#?\\right)", "Determinant of"),
      t("\\operatorname{tr}(A)", "\\operatorname{tr}\\left(#?\\right)", "Trace"),
      t("\\begin{pmatrix}x\\\\y\\\\z\\end{pmatrix}", "\\begin{pmatrix}#?\\\\#?\\\\#?\\end{pmatrix}", "3-vector"),
      t("A_{m\\times n}", "#?_{m\\times n}", "m×n matrix"),
      t("\\operatorname{rank}(A)", "\\operatorname{rank}\\left(#?\\right)", "Rank"),
    ],
  },
  {
    name: "Sets",
    items: [
      t("A\\cup B", "#?\\cup #?", "Union"),
      t("A\\cap B", "#?\\cap #?", "Intersection"),
      t("A\\setminus B", "#?\\setminus #?", "Difference"),
      t("A\\triangle B", "#?\\triangle #?", "Symmetric difference"),
      t("A\\subseteq B", "#?\\subseteq #?", "Subset"),
      t("x\\in A", "#?\\in #?", "Element of"),
      t("A\\times B", "#?\\times #?", "Cartesian product"),
      t("\\mathcal{P}(A)", "\\mathcal{P}\\left(#?\\right)", "Power set"),
      t("\\{x\\in\\mathbb{R}:x>0\\}", "\\left\\{#?\\in\\mathbb{R}\\;:\\;#?\\right\\}", "Set builder"),
      t("\\bigcup_{i=1}^{n}A_i", "\\bigcup_{i=1}^{n}A_{i}", "Indexed union"),
      t("\\bigcap_{i=1}^{n}A_i", "\\bigcap_{i=1}^{n}A_{i}", "Indexed intersection"),
      t("|A|", "\\left|#?\\right|", "Cardinality"),
    ],
  },
  {
    name: "Trig",
    items: [
      t("\\sin^2\\theta+\\cos^2\\theta=1", "\\sin^{2}\\theta+\\cos^{2}\\theta=1", "Pythagorean identity"),
      t("\\sin(a\\pm b)", "\\sin\\left(#?\\pm #?\\right)", "Sin sum"),
      t("\\cos(a\\pm b)", "\\cos\\left(#?\\pm #?\\right)", "Cos sum"),
      t("\\tan(a\\pm b)", "\\tan\\left(#?\\pm #?\\right)", "Tan sum"),
      t("\\tan\\theta=\\frac{\\sin\\theta}{\\cos\\theta}", "\\tan\\theta=\\frac{\\sin\\theta}{\\cos\\theta}", "Tangent"),
      t("\\sin^2\\theta = \\frac{1-\\cos 2\\theta}{2}", "\\sin^{2}\\theta=\\frac{1-\\cos 2\\theta}{2}", "Half-angle sin²"),
      t("\\cos^2\\theta = \\frac{1+\\cos 2\\theta}{2}", "\\cos^{2}\\theta=\\frac{1+\\cos 2\\theta}{2}", "Half-angle cos²"),
      t("\\frac{a}{\\sin A}=\\frac{b}{\\sin B}", "\\frac{a}{\\sin A}=\\frac{b}{\\sin B}", "Law of sines"),
      t("c^2=a^2+b^2-2ab\\cos C", "c^{2}=a^{2}+b^{2}-2ab\\cos C", "Law of cosines"),
      t("e^{i\\theta}=\\cos\\theta+i\\sin\\theta", "e^{i\\theta}=\\cos\\theta+i\\sin\\theta", "Euler's formula"),
      t("\\cos\\theta = \\frac{e^{i\\theta}+e^{-i\\theta}}{2}", "\\cos\\theta=\\frac{e^{i\\theta}+e^{-i\\theta}}{2}", "Cos exponential"),
      t("\\sin\\theta = \\frac{e^{i\\theta}-e^{-i\\theta}}{2i}", "\\sin\\theta=\\frac{e^{i\\theta}-e^{-i\\theta}}{2i}", "Sin exponential"),
    ],
  },
  {
    name: "Geometry",
    items: [
      t("\\triangle ABC", "\\triangle #?", "Triangle"),
      t("\\angle ABC", "\\angle #?", "Angle"),
      t("\\measuredangle ABC", "\\measuredangle #?", "Measured angle"),
      t("\\overline{AB}", "\\overline{#?}", "Segment"),
      t("\\overrightarrow{AB}", "\\overrightarrow{#?}", "Ray"),
      t("AB\\parallel CD", "#?\\parallel #?", "Parallel"),
      t("AB\\perp CD", "#?\\perp #?", "Perpendicular"),
      t("A=\\pi r^2", "A=\\pi r^{2}", "Circle area"),
      t("C=2\\pi r", "C=2\\pi r", "Circumference"),
      t("V=\\frac{4}{3}\\pi r^3", "V=\\frac{4}{3}\\pi r^{3}", "Sphere volume"),
      t("A=\\frac{1}{2}bh", "A=\\frac{1}{2}bh", "Triangle area"),
      t("d=\\sqrt{(x_2-x_1)^2+(y_2-y_1)^2}", "d=\\sqrt{\\left(x_{2}-x_{1}\\right)^{2}+\\left(y_{2}-y_{1}\\right)^{2}}", "Distance"),
    ],
  },
  {
    name: "Physics",
    items: [
      t("E=mc^2", "E=mc^{2}", "Mass–energy"),
      t("F=ma", "F=ma", "Newton's second"),
      t("\\vec{F}=m\\vec{a}", "\\vec{F}=m\\vec{a}", "Vector form"),
      t("F=G\\frac{m_1 m_2}{r^2}", "F=G\\frac{m_{1}m_{2}}{r^{2}}", "Gravity"),
      t("\\nabla\\cdot\\vec{E}=\\frac{\\rho}{\\epsilon_0}", "\\nabla\\cdot\\vec{E}=\\frac{\\rho}{\\epsilon_{0}}", "Gauss's law"),
      t("\\nabla\\cdot\\vec{B}=0", "\\nabla\\cdot\\vec{B}=0", "Gauss's law (mag)"),
      t("\\nabla\\times\\vec{E}=-\\frac{\\partial\\vec{B}}{\\partial t}", "\\nabla\\times\\vec{E}=-\\frac{\\partial\\vec{B}}{\\partial t}", "Faraday's law"),
      t("i\\hbar\\frac{\\partial}{\\partial t}\\Psi=\\hat{H}\\Psi", "i\\hbar\\frac{\\partial}{\\partial t}\\Psi=\\hat{H}\\Psi", "Schrödinger"),
      t("\\Delta x\\,\\Delta p\\ge\\frac{\\hbar}{2}", "\\Delta x\\,\\Delta p\\ge\\frac{\\hbar}{2}", "Uncertainty"),
      t("\\lambda=\\frac{h}{p}", "\\lambda=\\frac{h}{p}", "de Broglie"),
      t("E=h\\nu", "E=h\\nu", "Photon energy"),
      t("\\frac{1}{2}mv^2", "\\frac{1}{2}m#?^{2}", "Kinetic energy"),
    ],
  },
];
