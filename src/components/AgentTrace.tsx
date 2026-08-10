import { useEffect, useRef, useState } from "react";
import type { AgentStep, AgentStepPhase } from "@/types";
import { cn } from "@/utils/cn";

/**
 * The agent's work, shown above the answer it produced.
 *
 * Agent Mode makes several model calls per reply, and the user is paying for them in
 * latency. So the panel shows what each pass actually said — the plan, the audit's
 * findings, the checks that ran — rather than a status label that could be printed
 * whether or not any work happened. While a pass is streaming its text is visible and
 * auto-scrolled; once the answer lands the panel collapses to a one-line summary,
 * because the trace is evidence, not the point.
 *
 * The trace stays with the message, so it is still there after a reload.
 */

const PHASE_ICON: Record<AgentStepPhase, string> = {
  plan: "◇",
  solve: "◆",
  tools: "⚙",
  verify: "⌕",
  revise: "✎",
};

const PHASE_TONE: Record<AgentStepPhase, string> = {
  plan: "text-sky-300",
  solve: "text-violet-300",
  tools: "text-amber-300",
  verify: "text-cyan-300",
  revise: "text-emerald-300",
};

function elapsed(step: AgentStep): string {
  if (!step.endedAt) return "";
  const ms = step.endedAt - step.startedAt;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function AgentTrace({ steps, live }: { steps: AgentStep[]; live: boolean }) {
  // Open while the agent is working, collapsed once it is done. Anyone who wants to
  // read a finished trace can open it; nobody wants four expanded panels per reply
  // when scrolling back through a conversation.
  const [open, setOpen] = useState(live);
  const wasLive = useRef(live);
  useEffect(() => {
    if (wasLive.current && !live) setOpen(false);
    if (!wasLive.current && live) setOpen(true);
    wasLive.current = live;
  }, [live]);

  if (!steps.length) return null;

  const running = steps.find((s) => s.status === "running");
  const failed = steps.filter((s) => s.status === "failed").length;
  const total = steps.reduce((n, s) => n + (s.endedAt ? s.endedAt - s.startedAt : 0), 0);

  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-violet-400/20 bg-gradient-to-b from-violet-500/[0.07] to-transparent">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] transition-colors hover:bg-white/[0.03]"
      >
        <span className={cn("text-violet-300", running && "animate-pulse")}>✦</span>
        <span className="font-medium text-violet-200">
          {running ? running.label : failed ? "Agent finished with errors" : "Agent workflow"}
        </span>
        {running ? (
          <span className="flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1 w-1 animate-bounce rounded-full bg-violet-400"
                style={{ animationDelay: `${i * 120}ms` }}
              />
            ))}
          </span>
        ) : (
          <span className="text-slate-500">
            {steps.length} passes{total > 0 ? ` · ${(total / 1000).toFixed(1)}s` : ""}
          </span>
        )}
        <span className="ml-auto text-slate-500">{open ? "▴ hide" : "▾ show thinking"}</span>
      </button>

      {open && (
        <div className="space-y-1.5 border-t border-white/8 px-2 pb-2 pt-2">
          {steps.map((s) => (
            <StepRow key={s.id} step={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function StepRow({ step }: { step: AgentStep }) {
  const bodyRef = useRef<HTMLPreElement>(null);
  // Follow the tail while a pass is streaming. Only while running: scrolling a
  // finished step out from under someone reading it would be hostile.
  useEffect(() => {
    if (step.status === "running" && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [step.text, step.status]);

  const [open, setOpen] = useState(true);
  const showBody = open && !!step.text.trim();

  return (
    <div className="rounded-lg border border-white/8 bg-black/25">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px]"
      >
        <span className={cn("w-3 text-center", PHASE_TONE[step.phase])}>{PHASE_ICON[step.phase]}</span>
        <span className="text-slate-300">{step.label}</span>
        {step.status === "running" && <span className="text-[10px] text-violet-300">…</span>}
        {step.status === "failed" && <span className="text-[10px] text-rose-300">failed</span>}
        {step.summary && <span className="text-[10px] text-slate-500">· {step.summary}</span>}
        <span className="ml-auto flex items-center gap-2 text-[10px] text-slate-600">
          {elapsed(step)}
          {step.text.trim() && <span>{open ? "▴" : "▾"}</span>}
        </span>
      </button>
      {showBody && (
        <pre
          ref={bodyRef}
          className="max-h-52 overflow-y-auto whitespace-pre-wrap break-words border-t border-white/5 px-2.5 py-2 font-mono text-[10.5px] leading-relaxed text-slate-400"
        >
          {step.text.trim()}
          {step.status === "running" && <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-violet-400 align-middle" />}
        </pre>
      )}
    </div>
  );
}
