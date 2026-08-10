import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { loadMathLive, insertTemplate, readMathfield, type MathField } from "@/lib/mathlive";
import { matchShortcut } from "@/lib/mathTypePalettes";
import { clipboardToLatex } from "@/lib/smartPaste";

/**
 * Shortcut corrections applied on top of MathLive's defaults.
 *
 * Two problems are fixed here.
 *
 * The first is `*`. MathLive ships `"*": "\\cdot"`, so typing the multiplication key
 * produces a centre dot — but everyone outside a programming context reads `*` as "times"
 * and expects `×`. Being handed `·` when you asked for `×` reads as the editor refusing
 * the character, and there is no obvious way to get `×` back. So `*` gives `\times`, and
 * `.*` is kept for anyone who genuinely wants the dot.
 *
 * The second is typed and pasted Unicode. A physical keyboard, the OS character picker,
 * a virtual keyboard on a tablet and a paste from a plain-text document all deliver real
 * characters like `×`, `÷` or `≠`. MathLive maps a handful of these and drops the rest,
 * which is the same "nothing happened" failure in a different disguise. Mapping the
 * common operators, relations and Greek letters means a symbol from anywhere lands as
 * the right LaTeX command.
 */
const SHORTCUT_FIXES: Record<string, string> = {
  // ── the multiplication family ──
  "*": "\\times",
  ".*": "\\cdot",
  "xx": "\\times",
  "//": "\\div",
  "-:": "\\div",

  // ── operators, as literal characters ──
  "\u00D7": "\\times",   // ×
  "\u00F7": "\\div",     // ÷
  "\u22C5": "\\cdot",    // ⋅
  "\u00B7": "\\cdot",    // ·
  "\u2217": "\\ast",     // ∗
  "\u2218": "\\circ",    // ∘
  "\u2295": "\\oplus",   // ⊕
  "\u2297": "\\otimes",  // ⊗
  "\u00B1": "\\pm",      // ±
  "\u2213": "\\mp",      // ∓
  "\u2212": "-",         // − (Unicode minus, not a hyphen)
  "\u221A": "\\sqrt{#?}",// √
  "\u221B": "\\sqrt[3]{#?}",
  "\u2211": "\\sum",     // ∑
  "\u220F": "\\prod",    // ∏
  "\u222B": "\\int",     // ∫
  "\u222C": "\\iint",
  "\u222E": "\\oint",
  "\u2202": "\\partial", // ∂
  "\u2207": "\\nabla",   // ∇
  "\u221E": "\\infty",   // ∞

  // ── relations ──
  "\u2260": "\\ne",      // ≠
  "\u2264": "\\le",      // ≤
  "\u2265": "\\ge",      // ≥
  "\u2248": "\\approx",  // ≈
  "\u2261": "\\equiv",   // ≡
  "\u221D": "\\propto",  // ∝
  "\u226A": "\\ll",
  "\u226B": "\\gg",
  "\u2245": "\\cong",
  "\u223C": "\\sim",

  // ── sets and logic ──
  "\u2208": "\\in",      // ∈
  "\u2209": "\\notin",   // ∉
  "\u2282": "\\subset",  // ⊂
  "\u2286": "\\subseteq",
  "\u222A": "\\cup",     // ∪
  "\u2229": "\\cap",     // ∩
  "\u2205": "\\emptyset",// ∅
  "\u2200": "\\forall",  // ∀
  "\u2203": "\\exists",  // ∃
  "\u00AC": "\\neg",     // ¬
  "\u2227": "\\land",    // ∧
  "\u2228": "\\lor",     // ∨

  // ── arrows ──
  "\u2192": "\\to",          // →
  "\u2190": "\\leftarrow",   // ←
  "\u21D2": "\\Rightarrow",  // ⇒
  "\u21D0": "\\Leftarrow",   // ⇐
  "\u21D4": "\\iff",         // ⇔
  "\u2194": "\\leftrightarrow",
  "\u21A6": "\\mapsto",      // ↦

  // ── Greek, lower case ──
  "\u03B1": "\\alpha", "\u03B2": "\\beta", "\u03B3": "\\gamma", "\u03B4": "\\delta",
  "\u03B5": "\\epsilon", "\u03B6": "\\zeta", "\u03B7": "\\eta", "\u03B8": "\\theta",
  "\u03B9": "\\iota", "\u03BA": "\\kappa", "\u03BB": "\\lambda", "\u03BC": "\\mu",
  "\u03BD": "\\nu", "\u03BE": "\\xi", "\u03C0": "\\pi", "\u03C1": "\\rho",
  "\u03C3": "\\sigma", "\u03C4": "\\tau", "\u03C5": "\\upsilon", "\u03C6": "\\phi",
  "\u03C7": "\\chi", "\u03C8": "\\psi", "\u03C9": "\\omega",

  // ── Greek, upper case ──
  "\u0393": "\\Gamma", "\u0394": "\\Delta", "\u0398": "\\Theta", "\u039B": "\\Lambda",
  "\u039E": "\\Xi", "\u03A0": "\\Pi", "\u03A3": "\\Sigma", "\u03A6": "\\Phi",
  "\u03A8": "\\Psi", "\u03A9": "\\Omega",

  // ── misc ──
  "\u00B0": "\\degree",  // °
  "\u2032": "'",         // ′
  "\u2026": "\\ldots",   // …
  "\u212F": "e",
  "\u210F": "\\hbar",    // ℏ
  "\u2113": "\\ell",     // ℓ
};

/**
 * Mounts a MathLive `<math-field>` and keeps it in step with a LaTeX string owned by
 * React.
 *
 * The element is created imperatively rather than as JSX. `<math-field>` is a custom
 * element with its own shadow DOM and internal state; letting React own its attributes
 * invites it to be re-created on unrelated renders, which loses the caret and MathLive's
 * internal state. Appending it once by hand and talking to it through a ref is both
 * simpler and more predictable.
 *
 * Both MathType surfaces — the modal editor and the standalone tab — mount a field the
 * same way and hit the same sharp edges (the echo loop, remounting when the pane is
 * hidden, Enter/Space being unbound in maths mode, `*` becoming a centre dot, and paste
 * only understanding LaTeX), so the logic lives here once.
 */
export function useMathfield({
  enabled,
  value,
  onChange,
}: {
  /**
   * False while no visual pane is rendered. Hiding the pane unmounts the host div and
   * React discards the mathfield inside it, so coming back needs a fresh element —
   * this flag is what re-runs the mount.
   */
  enabled: boolean;
  value: string;
  onChange: (latex: string, opts?: { checkpoint?: boolean }) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mfRef = useRef<MathField | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState("Math");
  /** What the last smart paste did, for the editor to surface and then forget. */
  const [pasteNote, setPasteNote] = useState("");

  // `value` is the single source of truth, but the mathfield writes to it on every
  // keystroke. Without this guard, pushing state back into the field on each render
  // would reset the caret to the start of the formula as the user types.
  const echoRef = useRef(false);

  // The field is created asynchronously, so its initial value and its change handler
  // have to be read through refs — by the time the dynamic import resolves, whatever
  // the mount effect captured in its closure is stale.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useLayoutEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    loadMathLive()
      .then(({ MathfieldElement }) => {
        if (cancelled || !hostRef.current) return;
        const mf = new MathfieldElement({
          // Smart mode guesses when a run of letters is a word rather than a product
          // of variables. For OCR'd maths that guess is wrong more often than right,
          // so `sin x` stays `s·i·n·x` unless the user asks for text mode.
          smartMode: false,
          smartFence: true,
          removeExtraneousParentheses: false,
          mathVirtualKeyboardPolicy: "manual",
        });
        mf.value = valueRef.current;
        mf.style.width = "100%";
        // Grows with the formula instead of clipping it, and scrolls once it would
        // otherwise push the palettes and the Apply button out of reach.
        mf.style.minHeight = "140px";
        mf.style.maxHeight = "46vh";
        mf.style.overflow = "auto";
        mf.style.padding = "16px";
        mf.style.borderRadius = "12px";
        // Theme-aware through variables rather than literals: the field is built
        // imperatively, so it carries no Tailwind classes and cannot inherit the
        // theme the way every other surface does. The `--mf-field-*` tokens are
        // defined per theme in index.css, and because custom properties inherit
        // from <html>, a theme switch repaints the field with no remount.
        //
        // Longhands, not the `border`/`background` shorthands: a shorthand set
        // through CSSOM with a `var()` inside becomes a pending-substitution
        // value that Chromium does not resolve here, and `border` then falls
        // back to `currentColor` — which drew a bright white 1px outline around
        // the field in dark mode instead of the intended 10% white hairline.
        mf.style.borderWidth = "1px";
        mf.style.borderStyle = "solid";
        mf.style.borderColor = "var(--mf-field-border)";
        mf.style.backgroundColor = "var(--mf-field-bg)";
        mf.style.color = "var(--mf-field-fg)";
        mf.style.setProperty("--caret-color", "var(--mf-field-caret)");
        /**
         * Selection colours.
         *
         * A translucent tint is what MathLive defaults to, and at 28% violet over a
         * near-black field the highlight was almost invisible — a selected formula looked
         * the same as an unselected one, so there was no way to see what a palette click
         * was about to wrap. These are opaque instead, with an explicit foreground so the
         * glyphs stay legible against the fill rather than inheriting the body colour and
         * disappearing into it.
         *
         * MathLive reads exactly these two names (`--selection-color` and
         * `--selection-background-color`); it has no separate focused/unfocused pair, and
         * its own dark-scheme fallbacks only apply under `prefers-color-scheme: dark`,
         * which this field cannot rely on since the app's theme is the user's choice
         * rather than the OS's.
         */
        mf.style.setProperty("--selection-background-color", "var(--mf-field-sel-bg)");
        mf.style.setProperty("--selection-color", "var(--mf-field-sel-fg)");
        mf.style.setProperty("--contains-highlight-background-color", "var(--mf-field-contains)");
        mf.style.setProperty("--placeholder-color", "var(--mf-field-placeholder)");
        mf.style.setProperty("--smart-fence-color", "var(--mf-field-caret)");

        mf.addEventListener("input", () => {
          echoRef.current = true;
          onChangeRef.current(readMathfield(mf));
        });
        mf.addEventListener("selection-change", () => {
          const sel = mf.getValue(mf.selection, "latex");
          setStatus(sel ? `Selected: ${sel.length > 28 ? sel.slice(0, 28) + "…" : sel}` : "Math");
        });

        /**
         * Template shortcuts, then Enter and Space.
         *
         * MathLive does not bind Enter or Space in maths mode. A mathfield is a single
         * expression, so Enter does nothing by default and Space is swallowed — in LaTeX,
         * spacing is a command, not a character. Both are things people reach for
         * constantly when transcribing a multi-line derivation, and having them do
         * nothing reads as a broken editor. So Enter inserts a row break (\\, which is
         * what makes `aligned` and matrices work) and Space inserts `\;`, a real medium
         * space that survives the round trip to LaTeX. Shift+Enter is left alone for
         * MathLive's own use.
         *
         * The shortcut table is checked first, and only claims the event when it matches,
         * so every MathLive binding that is not in SHORTCUTS still works.
         */
        mf.addEventListener("keydown", (e: KeyboardEvent) => {
          const shortcut = matchShortcut(e);
          if (shortcut) {
            e.preventDefault();
            e.stopPropagation();
            insertTemplate(mf, shortcut.tex);
            echoRef.current = true;
            onChangeRef.current(readMathfield(mf), { checkpoint: true });
            return;
          }
          if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            e.stopPropagation();
            insertTemplate(mf, "\\\\");
            echoRef.current = true;
            onChangeRef.current(readMathfield(mf), { checkpoint: true });
          } else if (e.key === " " && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            e.stopPropagation();
            insertTemplate(mf, "\\;");
            echoRef.current = true;
            onChangeRef.current(readMathfield(mf));
          }
        }, true);

        /**
         * Smart paste. MathLive's own paste understands LaTeX and little else, so
         * pasting a formula copied out of a web page or out of Word drops raw markup
         * into the field as literal characters. Everything recoverable is recovered
         * here instead — a TeX annotation, MathML, or LaTeX still in its `$…$` — and
         * inserted as maths, so it renders the moment it lands. Anything unrecognised
         * falls through to MathLive untouched.
         */
        mf.addEventListener("paste", (ev: Event) => {
          const e = ev as ClipboardEvent;
          const data = e.clipboardData;
          if (!data) return;
          const result = clipboardToLatex(data.getData("text/html"), data.getData("text/plain"));
          if (!result?.latex.trim()) return;
          e.preventDefault();
          e.stopPropagation();
          // Multi-line results collapse to row breaks: a mathfield is one expression,
          // and `\\` is how it holds more than one line of it.
          insertTemplate(mf, result.latex.split("\n").join(" \\\\ "));
          echoRef.current = true;
          onChangeRef.current(readMathfield(mf), { checkpoint: true });
          setPasteNote(result.note);
        }, true);

        hostRef.current.appendChild(mf);

        /**
         * Shortcuts have to be set *after* the element is in the DOM.
         *
         * `inlineShortcuts` — both the getter and the setter — throws
         * "Mathfield not mounted" while MathLive's internal `_mathfield` is still null,
         * and that is only created by `connectedCallback`. Reading it before appending
         * therefore rejected the whole mount and surfaced as "the visual editor could
         * not load", with the LaTeX pane as the only thing left working.
         *
         * Layered over the defaults, not replacing them: the built-in set is large and
         * mostly right, and only the entries in SHORTCUT_FIXES are wrong or missing.
         * Wrapped because a bad shortcut table is a lost `×` key, not a lost editor —
         * it must never be able to take the mount down again.
         */
        try {
          mf.inlineShortcuts = { ...mf.inlineShortcuts, ...SHORTCUT_FIXES };
        } catch {
          /* keep MathLive's defaults; the palettes still insert every symbol */
        }

        mfRef.current = mf;
        setReady(true);
        // Focus after paint so the caret is visible the moment the editor appears.
        requestAnimationFrame(() => mf.focus());
      })
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : String(e)));

    return () => {
      cancelled = true;
      mfRef.current?.remove();
      mfRef.current = null;
      setReady(false);
      host.replaceChildren();
    };
  }, [enabled]);

  // Push external edits (the LaTeX pane, a palette applied while unfocused, Reset)
  // into the mathfield, but never echo back what the mathfield itself just told us.
  useEffect(() => {
    const mf = mfRef.current;
    if (!mf || !ready) return;
    if (echoRef.current) {
      echoRef.current = false;
      return;
    }
    const normalized = readMathfield(mf);
    if (normalized !== value) mf.value = value;
  }, [value, ready]);

  /** Insert a palette template at the caret, or append if the field is not up yet. */
  const insert = useCallback((tex: string) => {
    const mf = mfRef.current;
    if (mf) {
      insertTemplate(mf, tex);
      echoRef.current = true;
      // A palette click is one deliberate action, so it always gets its own history
      // entry — never merged into whatever the user happened to be typing before it.
      onChangeRef.current(readMathfield(mf), { checkpoint: true });
    } else {
      // MathLive still loading, or it failed — appending still does the right thing.
      onChangeRef.current(valueRef.current + tex.replace(/#\?/g, ""), { checkpoint: true });
    }
  }, []);

  /** Run one of MathLive's own commands (cut, copy, selectAll, …). */
  const cmd = useCallback((name: string) => {
    mfRef.current?.executeCommand(name as never);
    mfRef.current?.focus();
  }, []);

  /**
   * Paste from a menu rather than from Ctrl+V.
   *
   * The paste *event* carries the clipboard with it; a menu click does not, so the
   * clipboard has to be read through the async API. `read()` is what exposes the HTML
   * flavour — and therefore MathML and TeX annotations — but it needs permission and is
   * missing in some browsers, so a plain-text read is the fallback. Failing both, the
   * command goes back to MathLive, which at least handles LaTeX.
   */
  const smartPaste = useCallback(async () => {
    const mf = mfRef.current;
    let html = "";
    let plain = "";
    try {
      if (navigator.clipboard?.read) {
        for (const item of await navigator.clipboard.read()) {
          if (!html && item.types.includes("text/html")) html = await (await item.getType("text/html")).text();
          if (!plain && item.types.includes("text/plain")) plain = await (await item.getType("text/plain")).text();
        }
      }
    } catch {
      /* permission refused or unsupported — fall through to text */
    }
    if (!html && !plain) {
      try {
        plain = (await navigator.clipboard?.readText()) ?? "";
      } catch {
        /* nothing readable */
      }
    }

    const result = clipboardToLatex(html, plain);
    if (!result?.latex.trim()) {
      if (mf) { mf.executeCommand("pasteFromClipboard" as never); mf.focus(); }
      return;
    }
    insert(result.latex.split("\n").join(" \\\\ "));
    setPasteNote(result.note);
  }, [insert]);

  // The note is an acknowledgement, not a status: it says what just happened and then
  // gets out of the way.
  useEffect(() => {
    if (!pasteNote) return;
    const t = setTimeout(() => setPasteNote(""), 5000);
    return () => clearTimeout(t);
  }, [pasteNote]);

  return { hostRef, mfRef, ready, loadError, status, insert, cmd, smartPaste, pasteNote, setPasteNote };
}
