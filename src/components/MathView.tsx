import { useMemo } from "react";
import { cn } from "@/utils/cn";
import { renderLatex } from "@/lib/katexRender";
import { latexToMathml } from "@/lib/mathRender";
import { copyText } from "@/lib/utils";

/**
 * MathView — renders LaTeX with KaTeX (bulletproof, never shows parse errors).
 * On the rare total-failure case, shows the raw LaTeX in a styled code chip
 * with a copy button instead of an ugly red error.
 */
export function MathView({
  tex,
  display = true,
  className,
}: {
  tex: string;
  display?: boolean;
  className?: string;
}) {
  const html = useMemo(() => {
    if (!tex || !tex.trim()) return "";
    return renderLatex(tex, display);
  }, [tex, display]);

  if (html) {
    return display ? (
      <div
        className={cn("mf-math overflow-x-auto py-1", className)}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    ) : (
      <span className={cn("mf-math inline", className)} dangerouslySetInnerHTML={{ __html: html }} />
    );
  }

  // Graceful fallback: show raw LaTeX in a code chip instead of "invalid LaTeX".
  const raw = tex.trim();
  if (display) {
    return (
      <div className={cn("rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2", className)}>
        <code className="font-mono text-[12px] text-amber-200 break-all">{raw}</code>
        <button
          onClick={() => copyText(raw)}
          className="ml-2 text-[10px] text-amber-300/70 hover:text-amber-200"
          title="Copy LaTeX"
        >
          ⎘
        </button>
      </div>
    );
  }
  return (
    <code className={cn("rounded bg-amber-500/10 px-1 py-0.5 font-mono text-[12px] text-amber-200", className)}>
      {raw}
    </code>
  );
}

// Inline helper for raw MathML strings (used in exports preview).
export function RawMath({ mathml, className }: { mathml: string; className?: string }) {
  return <span className={cn("mf-math", className)} dangerouslySetInnerHTML={{ __html: mathml }} />;
}

// MathML string (for export) — still uses temml.
export function useMathml(tex: string, display = true) {
  return useMemo(() => (tex ? latexToMathml(tex, display) : ""), [tex, display]);
}
