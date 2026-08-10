import { useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";

/**
 * The model's own chain of thought, above the answer it led to.
 *
 * This is distinct from `AgentTrace`, which shows *this app's* workflow — plan, checks,
 * audit. What is shown here is the model thinking inside one of those passes: the
 * `<think>` block that MiniMax, Qwen and DeepSeek-R1 emit inline, or the `reasoning`
 * field Pollinations and OpenRouter put beside the content. Both are collected by
 * lib/thinking and lib/llm; by the time it reaches here it is plain text.
 *
 * Left in the answer, that text renders as the model muttering at the user — which is
 * what a MiniMax reply looked like before this existed. Discarding it instead would
 * throw away the most interesting part of a reasoning model's output, so it gets its
 * own panel: open and following the tail while the thought is being written, collapsed
 * to a one-line summary once the answer lands.
 */

/** Words are a better size cue than characters for a block of prose. */
function wordCount(s: string): number {
  const m = s.trim().match(/\S+/g);
  return m ? m.length : 0;
}

export function ThinkingPanel({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(live);
  const bodyRef = useRef<HTMLPreElement>(null);

  // How long the thinking took. Only measurable for a run seen live — a panel
  // rendered from a reloaded conversation shows nothing rather than a fabricated
  // duration.
  const startedRef = useRef<number | null>(null);
  const [took, setTook] = useState<number | null>(null);
  const wasLive = useRef(live);

  useEffect(() => {
    if (live && startedRef.current === null) startedRef.current = Date.now();
    // Auto-open on the way in, auto-collapse on the way out: while it is being
    // written the thought is the only thing to look at, and afterwards nobody wants
    // every reply in the scrollback expanded.
    if (!wasLive.current && live) setOpen(true);
    if (wasLive.current && !live) {
      setOpen(false);
      if (startedRef.current !== null) setTook(Date.now() - startedRef.current);
    }
    wasLive.current = live;
  }, [live]);

  useEffect(() => {
    if (live && open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [text, live, open]);

  const body = text.trim();
  if (!body) return null;

  const words = wordCount(body);

  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-sky-400/20 bg-gradient-to-b from-sky-500/[0.07] to-transparent">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] transition-colors hover:bg-white/[0.03]"
      >
        <span className={cn("text-sky-300", live && "animate-pulse")}>🧠</span>
        <span className="font-medium text-sky-200">{live ? "Thinking…" : "Thought process"}</span>
        {live ? (
          <span className="flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1 w-1 animate-bounce rounded-full bg-sky-400"
                style={{ animationDelay: `${i * 120}ms` }}
              />
            ))}
          </span>
        ) : (
          <span className="text-slate-500">
            {words} word{words === 1 ? "" : "s"}
            {took !== null ? ` · ${(took / 1000).toFixed(1)}s` : ""}
          </span>
        )}
        <span className="ml-auto text-slate-500">{open ? "▴ hide" : "▾ show"}</span>
      </button>

      {open && (
        <pre
          ref={bodyRef}
          className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words border-t border-white/8 px-3 py-2 font-mono text-[10.5px] leading-relaxed text-slate-400"
        >
          {body}
          {live && <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-sky-400 align-middle" />}
        </pre>
      )}
    </div>
  );
}
