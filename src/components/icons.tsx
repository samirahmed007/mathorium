import type { SVGProps } from "react";

/**
 * Line icons for the chat surface.
 *
 * The composer used to be a row of emoji — 📎 🖼️ 🎙️ 🎨 — which renders as a different
 * picture on every platform (colour on Windows, flat on Linux, Apple's own set on a Mac),
 * sits on a different baseline from the text beside it, and cannot take the hover colour
 * of the button that contains it. These are single-path strokes on a 24-grid instead:
 * they inherit `currentColor`, so a chip's active and disabled states actually reach the
 * glyph, and they line up with each other because they were drawn to the same metrics.
 *
 * Every icon takes the standard SVG props, so size and class come from the call site.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconPlus = (p: IconProps) => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
);

export const IconPaperclip = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21.44 11.05 12.25 20.24a5.5 5.5 0 0 1-7.78-7.78l8.49-8.48a3.67 3.67 0 0 1 5.19 5.19l-8.49 8.48a1.83 1.83 0 0 1-2.6-2.6l7.78-7.77" />
  </Svg>
);

export const IconImage = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2.5" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="m21 15-4.5-4.5L7 20" />
  </Svg>
);

/** Image generation — a wand, distinct from the plain picture frame of an upload. */
export const IconSparkles = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 3.5 11 7l3.5 1.5L11 10l-1.5 3.5L8 10l-3.5-1.5L8 7z" />
    <path d="M17.5 13.5 18.4 16l2.6 1-2.6 1-.9 2.5-.9-2.5-2.6-1 2.6-1z" />
  </Svg>
);

/** The usual microphone: capsule, cradle, stand. */
export const IconMic = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="2" width="6" height="11" rx="3" />
    <path d="M5 10.5a7 7 0 0 0 14 0M12 17.5V21M8.5 21h7" />
  </Svg>
);

export const IconStop = (p: IconProps) => (
  <Svg {...p}><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" /></Svg>
);

/** Send — an arrow up, the convention every chat composer uses. */
export const IconSend = (p: IconProps) => (
  <Svg {...p}><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></Svg>
);

export const IconAgent = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2.5 13.9 8l5.6 1.9-5.6 2L12 17.5l-1.9-5.6L4.5 9.9 10.1 8z" />
    <path d="M19 17.5v3.5M17.25 19.25h3.5" />
  </Svg>
);

export const IconCopy = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15a2 2 0 0 1-1-1.73V6a2 2 0 0 1 2-2h7.27A2 2 0 0 1 15 5" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}><path d="m4.5 12.5 5 5 10-11" /></Svg>
);

export const IconEdit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 20h8" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7.5 18.5l-4 1 1-4z" />
  </Svg>
);

export const IconRefresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 11a8 8 0 1 0-1.8 6" />
    <path d="M20 20v-5h-5" />
  </Svg>
);

export const IconDownload = (p: IconProps) => (
  <Svg {...p}><path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M4 20h16" /></Svg>
);

export const IconExpand = (p: IconProps) => (
  <Svg {...p}><path d="M9 3H3v6M15 21h6v-6M21 9V3h-6M3 15v6h6" /></Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}><path d="M18 6 6 18M6 6l12 12" /></Svg>
);

export const IconMenu = (p: IconProps) => (
  <Svg {...p}><path d="M4 6h16M4 12h16M4 18h16" /></Svg>
);

export const IconDice = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconFile = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </Svg>
);

export const IconArchive = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="5" rx="1.5" />
    <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10.5 13h3" />
  </Svg>
);

export const IconCode = (p: IconProps) => (
  <Svg {...p}><path d="m9 8-5 4 5 4M15 8l5 4-5 4" /></Svg>
);
