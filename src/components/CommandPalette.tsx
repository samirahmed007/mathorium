import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/utils/cn";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  group: "Navigate" | "Action" | "Theme" | "Help";
  keywords?: string;
  icon?: string;
  shortcut?: string[];
  run: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}

/**
 * CommandPalette — ⌘K / Ctrl+K overlay with fuzzy search.
 * Premium app feel: keyboard-navigable, grouped, with shortcuts shown.
 */
export function CommandPalette({ open, onClose, commands }: Props) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands
      .map((c) => {
        const text = (c.label + " " + (c.keywords || "") + " " + c.group + " " + (c.hint || "")).toLowerCase();
        let score = 0;
        if (text.includes(q)) score += 10;
        if (text.startsWith(q)) score += 5;
        // fuzzy match
        let qi = 0;
        for (let i = 0; i < text.length && qi < q.length; i++) {
          if (text[i] === q[qi]) qi++;
        }
        if (qi === q.length) score += 1;
        return { c, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.c);
  }, [query, commands]);

  const grouped = useMemo(() => {
    const out: Record<string, Command[]> = {};
    for (const c of filtered) {
      (out[c.group] = out[c.group] || []).push(c);
    }
    return out;
  }, [filtered]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // scroll active into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = filtered[activeIdx];
      if (c) {
        c.run();
        onClose();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  let runningIdx = -1;

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-[15vh]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-[fadeIn_.12s_ease]" onClick={onClose} />
      <div className="relative z-10 w-full max-w-xl overflow-hidden rounded-2xl border border-white/15 bg-[var(--surface-card)]/95 shadow-2xl backdrop-blur-xl animate-[popIn_.14s_ease]">
        <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-3">
          <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type a command or search…"
            className="flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          <kbd className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">ESC</kbd>
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
          {filtered.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-slate-500">No matching commands.</div>
          )}
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group} className="mb-2">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{group}</div>
              {items.map((c) => {
                runningIdx++;
                const idx = runningIdx;
                return (
                  <button
                    key={c.id}
                    data-idx={idx}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => {
                      c.run();
                      onClose();
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition",
                      idx === activeIdx ? "bg-violet-500/15 text-white" : "text-slate-300 hover:bg-white/5",
                    )}
                  >
                    <span className="w-5 text-center text-base">{c.icon || "›"}</span>
                    <span className="flex-1">
                      <span className="block leading-tight">{c.label}</span>
                      {c.hint && <span className="block text-[10px] text-slate-500">{c.hint}</span>}
                    </span>
                    {c.shortcut && (
                      <span className="flex gap-0.5">
                        {c.shortcut.map((k, i) => (
                          <kbd key={i} className="rounded border border-white/15 bg-white/5 px-1 py-0.5 text-[9px] text-slate-400">{k}</kbd>
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="border-t border-white/10 bg-white/[0.02] px-4 py-2 text-[10px] text-slate-500">
          <kbd className="rounded border border-white/15 bg-white/5 px-1 py-0.5">↑</kbd>
          <kbd className="ml-1 rounded border border-white/15 bg-white/5 px-1 py-0.5">↓</kbd> navigate ·
          <kbd className="ml-1 rounded border border-white/15 bg-white/5 px-1 py-0.5">↵</kbd> run ·
          <kbd className="ml-1 rounded border border-white/15 bg-white/5 px-1 py-0.5">ESC</kbd> close
        </div>
      </div>
    </div>
  );
}
