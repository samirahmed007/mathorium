import { useState } from "react";
import { useStore } from "@/store";
import { cn } from "@/utils/cn";
import { Button } from "./ui";

/**
 * ChatHistorySidebar — slide-out panel listing past conversations.
 * Click to restore, hover to rename/delete.
 */
export function ChatHistorySidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { conversations, activeConversationId, selectConversation, deleteConversation, renameConversation, newConversation } = useStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden" onClick={onClose} />}
      <aside
        className={cn(
          "fixed left-0 top-0 z-50 h-full w-72 transform border-r border-white/10 bg-[var(--surface-well)] transition-transform duration-200 md:relative md:z-0 md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0 md:hidden",
        )}
      >
        <div className="flex items-center justify-between border-b border-white/10 p-3">
          <span className="text-sm font-semibold text-white">Conversations</span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="primary" onClick={() => { newConversation(); onClose(); }}>+ New</Button>
            <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white md:hidden">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <div className="max-h-[calc(100vh-57px)] overflow-y-auto p-2">
          {sorted.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-slate-500">No conversations yet. Start chatting!</div>
          )}
          {sorted.map((c) => (
            <div
              key={c.id}
              className={cn(
                "group mb-1 rounded-lg px-2.5 py-2 text-sm transition",
                c.id === activeConversationId ? "bg-violet-500/15 text-white ring-1 ring-violet-400/30" : "text-slate-300 hover:bg-white/5",
              )}
            >
              {editingId === c.id ? (
                <input
                  autoFocus
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={() => { renameConversation(c.id, editText); setEditingId(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { renameConversation(c.id, editText); setEditingId(null); } if (e.key === "Escape") setEditingId(null); }}
                  className="w-full rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-sm text-white focus:outline-none"
                />
              ) : (
                <button
                  onClick={() => { selectConversation(c.id); onClose(); }}
                  className="block w-full text-left"
                >
                  <div className="truncate text-[13px] font-medium">{c.title || "Untitled"}</div>
                  <div className="mt-0.5 flex items-center justify-between text-[10px] text-slate-500">
                    <span>{c.messages.length} msgs</span>
                    <span>{new Date(c.updatedAt).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                  </div>
                </button>
              )}
              {editingId !== c.id && (
                <div className="mt-1 hidden items-center gap-1 group-hover:flex">
                  <button
                    onClick={() => { setEditingId(c.id); setEditText(c.title); }}
                    className="rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/10 hover:text-white"
                  >
                    ✎ rename
                  </button>
                  <button
                    onClick={() => { if (confirm("Delete this conversation?")) deleteConversation(c.id); }}
                    className="rounded px-1.5 py-0.5 text-[10px] text-rose-400 hover:bg-rose-500/10"
                  >
                    ✕ delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
