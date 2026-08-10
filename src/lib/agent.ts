// Agent Mode — a deliberate multi-step workflow layered over a single chat model.
//
// The premise is that most of the gap between a small model and a large one is not
// knowledge but process. A 3B model asked to "solve this integral" answers in one
// pass with no plan and no check; the same model asked to plan, then solve, then
// audit its own work, then fix what the audit found, gets a meaningful fraction of
// that gap back. This module is that process, expressed as ordinary calls into the
// existing chat transport — no tool sandbox, no special provider support, so it
// works with every provider in the app including a local GGUF file.
//
// Every phase is *observable*. The plan, the audit and the revision all stream token
// by token into a thinking panel above the answer, and the deterministic checks in
// `agentTools` report what they ran and what they found. Nothing about the workflow
// is asserted to the user without the underlying text being visible — a status line
// that says "checking the work" while nothing is happening is theatre, and the point
// here is that the work is real and can be read.
//
// The cost is latency and tokens: two short extra round trips at the default depth,
// plus a revision only when the audit actually finds something. `depth` is how the
// user trades that off, and Agent Mode can be switched off entirely.

import type { AgentStepPhase, ChatMessage, Provider, Settings } from "@/types";
import { chatReplyStream } from "./llm";
import { runChecks } from "./agentTools";
import { uid } from "./utils";

export type AgentDepth = "quick" | "balanced" | "thorough";

/** Which step of the workflow is running, for the status line in the chat UI. */
export type AgentPhase = AgentStepPhase | "done";

export const AGENT_PHASE_LABEL: Record<AgentPhase, string> = {
  plan: "Planning the approach",
  solve: "Working through it",
  tools: "Running checks",
  verify: "Auditing the draft",
  revise: "Correcting what the audit found",
  done: "Done",
};

/**
 * Appended to the user's own chat system prompt rather than replacing it, so the
 * conventions they configured (LaTeX style, tone, code formatting) still hold.
 */
export const AGENT_SYSTEM_SUFFIX = `

# AGENT MODE
You are operating in agent mode. Hold yourself to a higher standard than a quick reply:

1. UNDERSTAND FIRST. Restate what is actually being asked, in your own words, before answering. If the question is ambiguous, state the reading you are using and answer under it — do not stall for clarification unless answering either way would be actively misleading.
2. DECOMPOSE. Break non-trivial problems into named steps and work them in order. Do not skip algebra "for brevity"; a step you did not write is a step you did not check.
3. SHOW THE REASONING, NOT THE PERFORMANCE. Write the derivation, not a narration of how hard the problem is.
4. VERIFY BEFORE ASSERTING. Check results against an independent route where one exists: differentiate an integral back, substitute a root into the original equation, sanity-check magnitude, units, sign, and boundary cases. Say which check you ran.
5. KNOW WHAT YOU DO NOT KNOW. Distinguish what follows from the given information, what you are assuming, and what you are guessing. Never invent a citation, a constant, or a result.
6. FINISH THE TASK. Answer every part of a multi-part question. If one part is genuinely not answerable, answer the rest in full and say plainly which part you left and why.
7. END WITH THE ANSWER. Close with the result stated cleanly — \\boxed{...} for a single mathematical result — so it can be read without re-reading the derivation.`;

const PLAN_PROMPT = `Before answering, produce a brief working plan. Do NOT solve anything yet.

Reply with at most 120 words covering:
- RESTATE: what is being asked, in one sentence.
- METHOD: the approach you will use, named.
- STEPS: 2-6 numbered steps.
- TRAPS: the specific mistakes that are easy to make on this problem.

Plain text, no preamble.`;

const VERIFY_PROMPT = `Audit the draft answer above as a hostile reviewer would. You are looking for defects, not for reasons to approve.

Check, in order:
- Arithmetic and algebra, step by step. Recompute; do not eyeball.
- Whether the result actually satisfies the original problem (substitute back, differentiate back, check units and signs).
- Whether every part of the question was answered.
- Whether any claim is asserted without support, or any constant/citation invented.
- Whether the LaTeX is well formed.

If the draft is correct and complete, reply with exactly: PASS
Otherwise reply with a bare list of the defects, most serious first, each one naming the specific step and what is wrong. Do not rewrite the answer.`;

const REVISE_PROMPT = (defects: string) => `A review of your draft found these defects:

${defects}

Rewrite the answer in full, correcting every defect. Do not mention the review, the draft, or the corrections — produce the answer as it should have been written the first time. Keep everything the review did not fault.`;

/**
 * The workflow narrates itself through these. `step-*` events drive the thinking
 * panel; `delta`/`replace` carry the answer the user actually reads.
 */
export type AgentEvent =
  | { kind: "step-start"; id: string; phase: AgentStepPhase; label: string }
  | { kind: "step-delta"; id: string; text: string }
  | { kind: "step-end"; id: string; status: "done" | "skipped" | "failed"; summary?: string }
  | { kind: "delta"; text: string }
  | { kind: "replace"; text: string };

export interface AgentParams {
  provider: Provider;
  model: string;
  settings: Settings;
  history: ChatMessage[];
  depth: AgentDepth;
  signal?: AbortSignal;
  onProviderSwitch?: (newProviderId: string, reason: string, modelId?: string) => void;
  onContinue?: (round: number) => void;
  /**
   * Chain-of-thought from any pass, for the message's thinking panel.
   *
   * This is the *model's* own scratchpad — `<think>` blocks or a `reasoning` SSE
   * field — which is a different thing from the agent trace. The trace is this
   * module's workflow; reasoning is what the model was doing inside one step of it.
   */
  onReasoning?: (delta: string) => void;
}

const msg = (role: ChatMessage["role"], content: string): ChatMessage => ({
  id: uid("ag"),
  role,
  content,
  createdAt: 0,
});

/** True when the auditor found nothing. Models pad "PASS" in various ways. */
function isPass(verdict: string): boolean {
  const v = verdict.trim();
  if (!v) return true; // an empty audit is not evidence of a defect
  if (/^\W*pass\W*$/i.test(v)) return true;
  // "PASS — the derivation is correct" and similar.
  return /^\W*pass\b/i.test(v) && v.length < 200;
}

/** The last user turn, which the coverage check needs to compare the draft against. */
function lastUserText(history: ChatMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") return history[i].content;
  }
  return "";
}

export async function* agentReplyStream(params: AgentParams): AsyncGenerator<AgentEvent, void, unknown> {
  const { provider, model, settings, history, depth, signal } = params;
  const pass = { provider, model, settings, signal, onProviderSwitch: params.onProviderSwitch, onContinue: params.onContinue };

  const aborted = () => signal?.aborted === true;

  /**
   * Route one pass's chain of thought to the message's thinking panel.
   *
   * Not into the step body: a step's text is its *output* — the plan, the audit's
   * verdict — and `isPass` and the defect list are parsed straight out of it, so
   * folding the scratchpad in would corrupt both. The panel gets a one-line marker
   * naming the pass, otherwise several passes' thoughts arrive as one undifferentiated
   * block with no way to tell which was thinking what.
   */
  const reasoner = (label: string) => {
    let first = true;
    return (delta: string) => {
      if (!params.onReasoning) return;
      if (first) {
        first = false;
        params.onReasoning(`\n\n── ${label} ──\n`);
      }
      params.onReasoning(delta);
    };
  };

  /**
   * Run one model call as a visible step: its text streams into the thinking panel
   * as it arrives, so a slow audit reads as work in progress rather than a hang.
   * A phase that throws is reported and stepped over — a broken audit must not cost
   * the user an answer that was already produced.
   */
  async function* runStep(
    phase: AgentStepPhase,
    label: string,
    turns: ChatMessage[],
    settingsOverride?: Partial<Settings>,
  ): AsyncGenerator<AgentEvent, string, unknown> {
    const id = uid("st");
    yield { kind: "step-start", id, phase, label };
    let text = "";
    try {
      for await (const chunk of chatReplyStream({
        ...pass,
        settings: { ...settings, ...settingsOverride },
        history: turns,
        onReasoning: reasoner(label),
      })) {
        if (aborted()) break;
        text += chunk;
        yield { kind: "step-delta", id, text: chunk };
      }
    } catch (e) {
      yield { kind: "step-end", id, status: "failed", summary: e instanceof Error ? e.message : String(e) };
      return "";
    }
    yield { kind: "step-end", id, status: "done" };
    return text;
  }

  // ── Plan ──────────────────────────────────────────────────────────────
  // Skipped at "quick": on a short factual question the plan costs a round trip
  // and tells the model nothing it did not already know.
  let plan = "";
  if (depth !== "quick") {
    plan = yield* runStep(
      "plan",
      "Planning the approach",
      [...history, msg("user", PLAN_PROMPT)],
      // A plan is short by construction; letting it run to the full output cap
      // wastes time and invites it to start solving.
      { maxTokens: Math.min(settings.maxTokens, 512) },
    );
    if (aborted()) return;
  }

  // ── Solve ─────────────────────────────────────────────────────────────
  const solveId = uid("st");
  yield { kind: "step-start", id: solveId, phase: "solve", label: "Working through it" };

  const solveHistory: ChatMessage[] = plan.trim()
    ? [
        ...history,
        msg(
          "system",
          `Your working plan for the message you are about to answer:\n\n${plan.trim()}\n\nFollow it. Do not mention the plan or that you made one — answer the user's message directly.`,
        ),
      ]
    : history;

  let draft = "";
  try {
    for await (const chunk of chatReplyStream({ ...pass, history: solveHistory, onReasoning: reasoner("Working through it") })) {
      if (aborted()) return;
      draft += chunk;
      yield { kind: "delta", text: chunk };
    }
  } catch (e) {
    yield { kind: "step-end", id: solveId, status: "failed", summary: e instanceof Error ? e.message : String(e) };
    throw e; // the answer itself failing is fatal — the caller renders the error
  }
  yield { kind: "step-end", id: solveId, status: "done", summary: `${draft.trim().length} chars` };

  if (aborted() || !draft.trim()) return;

  // ── Deterministic checks ──────────────────────────────────────────────
  // Run before the model audit so its findings can be handed over as established
  // fact. A parser knows whether LaTeX renders; asking a model to guess is worse.
  const toolsId = uid("st");
  yield { kind: "step-start", id: toolsId, phase: "tools", label: "Running checks" };
  const checks = runChecks(lastUserText(history), draft);
  for (const line of checks.log) yield { kind: "step-delta", id: toolsId, text: `• ${line}\n` };
  if (checks.findings.length) {
    yield { kind: "step-delta", id: toolsId, text: `\nFound ${checks.findings.length} issue(s):\n` };
    for (const f of checks.findings) yield { kind: "step-delta", id: toolsId, text: `  [${f.tool}] ${f.detail}\n` };
  }
  yield {
    kind: "step-end",
    id: toolsId,
    status: "done",
    summary: checks.findings.length ? `${checks.findings.length} issue(s)` : "clean",
  };

  // ── Verify ────────────────────────────────────────────────────────────
  const verdict = yield* runStep(
    "verify",
    "Auditing the draft",
    [...history, msg("assistant", draft), msg("user", VERIFY_PROMPT)],
    { maxTokens: Math.min(settings.maxTokens, 768), temperature: 0 },
  );
  if (aborted()) return;

  const defects = [
    ...(isPass(verdict) ? [] : [verdict.trim()]),
    ...checks.findings.map((f) => f.detail),
  ].filter(Boolean);

  if (!defects.length) return;

  // ── Revise ────────────────────────────────────────────────────────────
  // The revision is not streamed into the answer as it arrives: it would appear
  // interleaved with the draft it is replacing. It streams into the thinking panel
  // instead, then swaps the answer wholesale once complete.
  const revised = yield* runStep(
    "revise",
    "Correcting what the audit found",
    [...history, msg("assistant", draft), msg("user", REVISE_PROMPT(defects.join("\n")))],
  );
  if (aborted()) return;

  // Only replace if the revision is substantial. A model that answers the revise
  // prompt with "the original was fine" must not blank the answer.
  let current = draft;
  if (revised.trim().length > Math.min(80, draft.trim().length / 2)) {
    current = revised;
    yield { kind: "replace", text: revised };
  }

  // ── Thorough: one more audit/repair cycle ─────────────────────────────
  // A single pass catches the obvious defects; a second catches the ones the
  // first pass introduced. Beyond two the returns are not worth the latency.
  if (depth === "thorough" && current !== draft) {
    const second = yield* runStep(
      "verify",
      "Auditing the correction",
      [...history, msg("assistant", current), msg("user", VERIFY_PROMPT)],
      { maxTokens: Math.min(settings.maxTokens, 768), temperature: 0 },
    );
    if (aborted()) return;

    if (!isPass(second)) {
      const final = yield* runStep(
        "revise",
        "Applying the second correction",
        [...history, msg("assistant", current), msg("user", REVISE_PROMPT(second.trim()))],
      );
      if (!aborted() && final.trim().length > Math.min(80, current.trim().length / 2)) {
        yield { kind: "replace", text: final };
      }
    }
  }
}
