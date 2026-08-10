import { useId } from "react";

/**
 * The Mathorium mark.
 *
 * One shape, drawn once, used everywhere: the header, the About page, the chat
 * avatar, the crash screen, the favicon and the PWA icons all render this file
 * (the icon files under `public/` are rasterised from the same geometry by
 * `scripts/make-icons.mjs`, so the app icon and the in-app logo can never drift
 * apart).
 *
 * What it is: an `M` drawn as a single polyline — the monogram, and also a plotted
 * path — with its valley marked by a node, the way a graph marks a minimum. That
 * reading is the point: the previous logo was the ⚛ emoji, which is a physics
 * glyph, renders as a different picture on every platform, and cannot take a
 * gradient. This is geometry, so it is identical on every machine, scales from
 * 16px to 512, and the silhouette stays a legible M when the cyan node collapses
 * to a couple of pixels.
 *
 * Ids are per-instance (`useId`) because two mounted marks would otherwise both
 * point at whichever `<defs>` came first in the document, and unmounting that one
 * would strip the gradient from the other.
 */
export function MathoriumMark({ size = 32, className, title }: { size?: number; className?: string; title?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const tile = `mt${uid}`;
  const gloss = `mg${uid}`;
  const node = `mn${uid}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <linearGradient id={tile} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="52%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#4338ca" />
        </linearGradient>
        {/* A single specular highlight in the top-left. Without it the tile is a
            flat swatch; with it the mark reads as a physical key, which is the
            house style of the app's other gradient surfaces. */}
        <radialGradient id={gloss} cx="26%" cy="16%" r="78%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="62%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={node} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#67e8f9" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
      <rect x="16" y="16" width="480" height="480" rx="120" fill={`url(#${tile})`} />
      <rect x="16" y="16" width="480" height="480" rx="120" fill={`url(#${gloss})`} />
      {/* The glass edge. Inset by half the stroke so it sits inside the tile
          rather than straddling its silhouette. */}
      <rect x="22" y="22" width="468" height="468" rx="114" fill="none" stroke="#ffffff" strokeOpacity="0.2" strokeWidth="12" />
      <path
        d="M136 360V152l120 136 120-136v208"
        fill="none"
        stroke="#ffffff"
        strokeWidth="52"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* The marked minimum. The white collar keeps it distinct from the stroke it
          sits on, which is the same white. */}
      <circle cx="256" cy="288" r="34" fill="#ffffff" />
      <circle cx="256" cy="288" r="25" fill={`url(#${node})`} />
    </svg>
  );
}

/**
 * Mark plus wordmark, for the places that introduce the app rather than just
 * label it. `.gradient-text` is the app's existing brand-text treatment and is
 * already theme-aware, so the word follows the theme while the mark — a solid
 * accent surface — deliberately does not.
 */
export function MathoriumLogo({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <MathoriumMark size={size} title="Mathorium" />
      <span className="gradient-text text-[19px] font-bold tracking-tight">Mathorium</span>
    </span>
  );
}
