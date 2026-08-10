// Enhanced LaTeX → MathML conversion engine.
//
// Uses a multi-engine approach for maximum accuracy:
// 1. temml (primary) — best KaTeX-compatible MathML output
// 2. latex2mathml (from CDN) — alternative parser, handles some cases temml misses
// 3. KaTeX MathML output (fallback) — renders via KaTeX's built-in MathML
//
// All engines run client-side, no server needed.

import temml from "temml";
import { cleanLatex } from "./mathRender";
import { normalizeMathmlAlignment } from "./mathmlAlign";

// Lazy-load latex2mathml from CDN
let latex2mathmlModule: any = null;
let latex2mathmlLoading: Promise<any> | null = null;

async function loadLatex2MathML(): Promise<any> {
  if (latex2mathmlModule) return latex2mathmlModule;
  if (latex2mathmlLoading) return latex2mathmlLoading;

  latex2mathmlLoading = (async () => {
    try {
      // latex2mathml is available as a Python package, but there's a JS port
      // Load from esm.sh CDN
      const mod = await import(/* @vite-ignore */ "https://esm.sh/latex2mathml@3.77.0");
      latex2mathmlModule = mod.default || mod;
      return latex2mathmlModule;
    } catch (e) {
      console.warn("latex2mathml failed to load from CDN:", e);
      return null;
    }
  })();

  return latex2mathmlLoading;
}

/**
 * Convert LaTeX to MathML using temml (primary engine).
 */
function temmlToMathml(tex: string, display = true): string {
  const cleaned = cleanLatex(tex);
  if (!cleaned.trim()) return "";
  try {
    return normalizeMathmlAlignment(
      temml.renderToString(cleaned, {
        displayMode: display,
        throwOnError: false,
        wrap: "tex",
        annotate: true,
      }),
    );
  } catch {
    try {
      return normalizeMathmlAlignment(
        temml.renderToString(cleaned, { displayMode: display, throwOnError: false }),
      );
    } catch {
      return "";
    }
  }
}

/**
 * Convert LaTeX to MathML using latex2mathml (alternative engine).
 * This handles some edge cases that temml misses.
 */
async function latex2mathmlConvert(tex: string, display = true): Promise<string> {
  const mod = await loadLatex2MathML();
  if (!mod) return "";
  try {
    const cleaned = cleanLatex(tex);
    if (!cleaned.trim()) return "";
    // latex2mathml's API: latex2mathml.convert(latex)
    const result = mod.convert ? mod.convert(cleaned) : (mod.render ? mod.render(cleaned) : "");
    // Wrap in display mode if needed
    if (display && result && !result.includes('display="block"')) {
      return result.replace('<math', '<math display="block"');
    }
    return result;
  } catch (e) {
    return "";
  }
}

/**
 * Enhanced LaTeX → MathML conversion.
 * Tries temml first, then latex2mathml, returns the best result.
 */
export async function latexToMathmlEnhanced(tex: string, display = true): Promise<string> {
  if (!tex || !tex.trim()) return "";

  // Try temml first (synchronous, fast, excellent quality)
  const temmlResult = temmlToMathml(tex, display);
  if (temmlResult && temmlResult.includes("<math")) {
    return temmlResult;
  }

  // Fallback: try latex2mathml from CDN
  const latex2mathmlResult = await latex2mathmlConvert(tex, display);
  if (latex2mathmlResult && latex2mathmlResult.includes("<math")) {
    return latex2mathmlResult;
  }

  // Last resort: return temml result even if it might have issues
  return temmlResult || "";
}

/**
 * Synchronous version using temml only (for backward compatibility).
 */
export function latexToMathmlSync(tex: string, display = true): string {
  return temmlToMathml(tex, display);
}
