import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";

/**
 * Zoomable / pannable source-image viewer.
 *
 * Reading OCR output against the original glyphs is the core verification loop
 * of this app, so the image needs to get genuinely large — a thumbnail forces
 * the user to guess whether that's a `l` or a `1`. Zoom is therefore not a
 * nicety here: scale, pan, and a full-viewport lightbox are the primary tools.
 */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const STEP = 1.25;

function clamp(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function ImageZoom({
  src,
  alt,
  className,
  heightClass = "h-64 md:h-80",
}: {
  src: string;
  alt?: string;
  className?: string;
  /** Height of the inline (non-lightbox) viewport. */
  heightClass?: string;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [full, setFull] = useState(false);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const reset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Zoom keeps the image centred; panning only makes sense once it overflows.
  const zoomBy = useCallback((factor: number) => {
    setZoom((z) => {
      const next = clamp(z * factor);
      if (next <= 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  // Ctrl/⌘+wheel zooms, matching every image viewer the user already knows.
  // Plain wheel is left alone so the page keeps scrolling normally.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? STEP : 1 / STEP);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy, full]);

  // Escape closes the lightbox; +/-/0 drive zoom while it is open.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
      else if (e.key === "+" || e.key === "=") zoomBy(STEP);
      else if (e.key === "-") zoomBy(1 / STEP);
      else if (e.key === "0") reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full, zoomBy, reset]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1) return;
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const controls = (
    <div className="flex items-center gap-1">
      <button
        onClick={() => zoomBy(1 / STEP)}
        disabled={zoom <= MIN_ZOOM}
        className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-40"
        title="Zoom out (−)"
      >
        −
      </button>
      <button
        onClick={reset}
        className="min-w-[46px] rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-300 hover:bg-white/10"
        title="Reset zoom (0)"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        onClick={() => zoomBy(STEP)}
        disabled={zoom >= MAX_ZOOM}
        className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-40"
        title="Zoom in (+)"
      >
        +
      </button>
      <button
        onClick={() => setFull((v) => !v)}
        className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-white/10"
        title={full ? "Exit fullscreen (Esc)" : "Fullscreen"}
      >
        {full ? "✕ Close" : "⛶ Full"}
      </button>
    </div>
  );

  const image = (
    <img
      src={src}
      alt={alt || ""}
      draggable={false}
      className="max-h-full max-w-full select-none object-contain"
      style={{
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        transformOrigin: "center center",
        transition: dragRef.current ? "none" : "transform 120ms ease-out",
      }}
    />
  );

  return (
    <>
      <div className={cn("space-y-1.5", className)}>
        <div
          ref={boxRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={() => (zoom > 1 ? reset() : zoomBy(STEP * STEP))}
          className={cn(
            "flex items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/40",
            heightClass,
            zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in",
          )}
          title="Ctrl/⌘+scroll to zoom · double-click to toggle · drag to pan"
        >
          {image}
        </div>
        {controls}
      </div>

      {full && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm">
          <div className="flex items-center gap-3 border-b border-white/10 px-4 py-2">
            <span className="truncate text-sm text-slate-300">{alt}</span>
            <div className="ml-auto">{controls}</div>
          </div>
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={() => (zoom > 1 ? reset() : zoomBy(STEP * STEP))}
            className={cn(
              "flex flex-1 items-center justify-center overflow-hidden p-4",
              zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in",
            )}
          >
            {image}
          </div>
        </div>
      )}
    </>
  );
}
