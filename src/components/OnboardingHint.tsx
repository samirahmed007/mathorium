import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";
import { APP_NAME, APP_VERSION } from "@/lib/version";
import { MathoriumMark } from "./Brand";

const TIPS = [
  { icon: "🖼️", title: "Drop images anywhere", body: "Drag a folder of math images onto the Convert tab — batch 500+ with auto-retry." },
  { icon: "⌘K", title: "Command palette", body: "Press ⌘K / Ctrl+K anywhere to jump between tabs, toggle theme, or run actions." },
  { icon: "🎨", title: "Image generation", body: "In Chat tab, click the 🎨 button to switch to free image generation mode (Pollinations Flux)." },
  { icon: "🤖", title: "Auto provider rotation", body: "If the selected provider fails or does not respond, Mathorium auto-rotates to LLM7, Puter, or WebLLM — and tells you which model actually answered." },
  { icon: "✎", title: "Edit & regenerate", body: "Hover any chat message to copy, edit-and-resend, or regenerate the assistant's reply." },
  { icon: "⤓", title: "9 export formats", body: "Export results as HTML, ZIP, LaTeX, MathML, Markdown, CSV, JSON, or plain text." },
  { icon: "?", title: "Keyboard shortcuts", body: "Press ? to see all keyboard shortcuts at any time." },
];

const STORAGE_KEY = "mathforge.onboarded.v4";

/**
 * OnboardingHint — a 7-tip first-run tour shown on the very first load.
 * Dismissed state persists across sessions.
 */
export function OnboardingHint() {
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setOpen(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  if (!open) return null;
  const tip = TIPS[idx];
  const isLast = idx === TIPS.length - 1;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={close} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/15 bg-[var(--surface-card)] p-6 shadow-2xl animate-[popIn_.18s_ease]">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MathoriumMark size={32} className="shrink-0" title={APP_NAME} />
            <span className="font-semibold text-white">Welcome to {APP_NAME} v{APP_VERSION}</span>
          </div>
          <button onClick={close} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-2xl">{tip.icon}</div>
          <div>
            <div className="font-semibold text-white">{tip.title}</div>
            <div className="mt-0.5 text-[12px] leading-snug text-slate-400">{tip.body}</div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-1">
            {TIPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === idx ? "w-5 bg-violet-500" : "w-1.5 bg-white/20 hover:bg-white/30",
                )}
                aria-label={`Tip ${i + 1}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={close} className="rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:bg-white/5 hover:text-white">Skip</button>
            {!isLast ? (
              <button
                onClick={() => setIdx((i) => i + 1)}
                className="rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 px-4 py-1.5 text-xs font-semibold text-on-accent hover:from-violet-400 hover:to-indigo-500"
              >
                Next →
              </button>
            ) : (
              <button
                onClick={close}
                className="rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 px-4 py-1.5 text-xs font-semibold text-on-accent hover:from-emerald-400 hover:to-teal-500"
              >
                Get started ✓
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
