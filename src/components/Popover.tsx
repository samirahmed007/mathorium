import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A dropdown that escapes its container.
 *
 * The editor's chrome is a scrolling flex column inside a rounded dialog, which means
 * `overflow-hidden` somewhere above every toolbar button. An absolutely-positioned
 * menu inside that tree gets clipped to the toolbar strip — which is why the palette
 * dropdowns showed as a sliver of their first column. Portalling to `document.body`
 * and positioning with fixed coordinates takes the menu out of that tree entirely.
 *
 * Position is measured from the anchor after mount, then flipped left or up when the
 * menu would otherwise run off the viewport — the right-hand palettes in a full-width
 * toolbar are close enough to the edge that this is the common case, not the corner one.
 */
export function Popover({
  anchor,
  open,
  children,
  align = "start",
  className = "",
}: {
  anchor: HTMLElement | null;
  open: boolean;
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor) { setPos(null); return; }

    const place = () => {
      const el = ref.current;
      if (!el) return;
      const a = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const pad = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let left = align === "end" ? a.right - w : a.left;
      // Keep it on screen horizontally, preferring to slide rather than to flip —
      // a menu that jumps to the far side of its button is harder to follow than
      // one that hugs the edge.
      left = Math.min(left, vw - w - pad);
      left = Math.max(pad, left);

      const below = vh - a.bottom - pad;
      const above = a.top - pad;
      // Open upward only when there is genuinely more room there.
      const flip = below < Math.min(h, 220) && above > below;
      const top = flip ? Math.max(pad, a.top - h - 4) : a.bottom + 4;
      const maxHeight = Math.max(160, (flip ? above : below) - 4);

      setPos({ top, left, maxHeight });
    };

    place();
    // Re-measure once the content has laid out — the first pass reads a width of 0
    // for a menu that has not painted yet.
    const raf = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, align, children]);

  if (!open) return null;

  return createPortal(
    <div
      ref={ref}
      data-popover
      style={{
        position: "fixed",
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        maxHeight: pos?.maxHeight,
        // Above the dialog (z-60) that owns the button.
        zIndex: 90,
        // Hidden until measured, so it never flashes at the top-left corner.
        visibility: pos ? "visible" : "hidden",
      }}
      className={
        "overflow-y-auto overscroll-contain rounded-xl border border-white/10 bg-[var(--surface-pop)] shadow-2xl shadow-black/70 " +
        className
      }
    >
      {children}
    </div>,
    document.body,
  );
}
