import { useEffect } from "react";

const SHORTCUTS: { keys: string[]; action: string; group: string }[] = [
  { keys: ["⌘K", "Ctrl+K"], action: "Open command palette", group: "Global" },
  { keys: ["?"], action: "Show this shortcuts help", group: "Global" },
  { keys: ["⌘⇧L", "Ctrl+Shift+L"], action: "Toggle light/dark theme", group: "Global" },
  { keys: ["⌘⇧N", "Ctrl+Shift+N"], action: "New chat", group: "Global" },
  { keys: ["G", "C"], action: "Go to Convert tab", group: "Navigate" },
  { keys: ["G", "L"], action: "Go to LaTeX tab", group: "Navigate" },
  { keys: ["G", "H"], action: "Go to Chat tab", group: "Navigate" },
  { keys: ["G", "P"], action: "Go to Providers tab", group: "Navigate" },
  { keys: ["G", "S"], action: "Go to Settings tab", group: "Navigate" },
  { keys: ["⌘E", "Ctrl+E"], action: "Export (in Convert tab)", group: "Action" },
  { keys: ["Enter"], action: "Send chat message", group: "Chat" },
  { keys: ["⇧", "Enter"], action: "New line in chat", group: "Chat" },
  { keys: ["Esc"], action: "Close any modal / palette", group: "Global" },
];

/**
 * ShortcutsHelp — ? overlay listing all keyboard shortcuts.
 * Auto-closes on Esc.
 */
export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const grouped: Record<string, typeof SHORTCUTS> = {};
  for (const s of SHORTCUTS) (grouped[s.group] = grouped[s.group] || []).push(s);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-white/15 bg-[var(--surface-card)] p-5 shadow-2xl animate-[popIn_.15s_ease]">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">Keyboard shortcuts</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="space-y-4">
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group}>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{group}</div>
              <div className="space-y-1">
                {items.map((s, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-white/5">
                    <span className="text-sm text-slate-300">{s.action}</span>
                    <div className="flex gap-1">
                      {s.keys.map((k, j) => (
                        <kbd key={j} className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">{k}</kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
