/**
 * Auto-continuation — stop long answers from being cut off mid-sentence.
 *
 * Every provider caps a single completion at `max_tokens`. When a model hits that
 * cap it stops wherever it happens to be — mid-word, mid-equation, mid-code-fence
 * — and reports `finish_reason: "length"`. Raising the cap only moves the cliff;
 * it never removes it, and most free providers refuse large values anyway.
 *
 * The fix is to treat a length-stop as "not finished yet": feed the partial answer
 * back as context, ask for the remainder, and stitch the pieces together. Repeat
 * until the model stops for a real reason or a safety limit is reached.
 *
 * Making the seam invisible is the hard part. Two artefacts have to go:
 *
 *  1. **Preamble.** Models like to restart conversationally ("Continuing from
 *     where we left off, ..."). That is an artefact of the continuation request,
 *     not part of the answer.
 *  2. **The join itself.** Concatenating blind either duplicates text (the model
 *     re-emitted the last few words) or fuses two words together (it resumed
 *     mid-word, which is exactly what a token-boundary cut produces). Guessing
 *     from the characters alone is genuinely ambiguous — `"the" + "derivative"`
 *     needs a space, `"deriv" + "ative"` must not have one, and both look
 *     identical to a regex.
 *
 * So rather than guess, the continuation prompt *asks* the model to echo the last
 * few characters verbatim. That turns the seam into an overlap-detection problem,
 * which has an exact answer. The character heuristic stays only as a fallback for
 * models that ignore the instruction.
 */

import { estimateTokens } from "./tokens";

/** Hard ceiling on continuation rounds, so a degenerate model cannot loop forever. */
export const MAX_CONTINUATION_ROUNDS = 12;

/**
 * Below this many new characters, a round counts as having made no real progress.
 *
 * A model that considers itself finished answers a continuation request with a
 * pleasantry, or by echoing the quoted tail and nothing else. Both leave a round
 * that is non-empty (so the existing blank-round check misses it) but adds nothing,
 * and continuing again just produces another one. Continuation is only worth doing
 * while it is actually producing answer.
 */
export const MIN_CONTINUATION_PROGRESS = 24;

/** How much trailing text to quote back, and to scan when looking for the overlap. */
const TAIL_CHARS = 120;
const OVERLAP_WINDOW = 400;

/** Longest assistant context to resend; older text is elided from the front. */
const MAX_CONTEXT_CHARS = 12000;

/**
 * Ask for the remainder, quoting the tail so the model can align itself — and so
 * we can find the seam exactly when it echoes that tail back.
 */
export function buildContinuePrompt(soFar: string): string {
  const tail = soFar.slice(-TAIL_CHARS);
  return (
    "Your previous message was cut off because it hit the output length limit. " +
    "It ended with:\n\n" +
    "···" + tail + "\n\n" +
    "Continue it from exactly that point. Start your reply by repeating those final few " +
    "characters verbatim, then carry straight on — including finishing the current word " +
    "or equation if it was cut mid-way. Do not summarise, do not restart, and do not add " +
    "any preamble such as \"continuing\". If the response was in fact already complete, " +
    "reply with nothing at all."
  );
}

/** Trim the assistant context we resend so a very long answer cannot blow the window. */
export function contextForContinuation(soFar: string): string {
  if (soFar.length <= MAX_CONTEXT_CHARS) return soFar;
  return "[…earlier part of this response omitted…]\n" + soFar.slice(-MAX_CONTEXT_CHARS);
}

/**
 * Did this completion stop because it ran out of room?
 *
 * `finish_reason` is authoritative when the provider sends it. Several free
 * providers (Puter, DuckDuckGo, Pollinations, and LLM7 while streaming) don't, so
 * fall back to a deliberately conservative shape test: only treat it as truncated
 * when the text both looks unfinished *and* is close enough to the cap that
 * truncation is a plausible explanation. Guessing wrong costs a useless extra
 * round, so the bar is set high.
 *
 * `roundText` is what *this* completion returned; `fullText` is everything
 * accumulated across rounds. The distinction matters and getting it wrong is what
 * made auto-continuation unstoppable: the cap applies per completion, so measuring
 * the accumulated answer against it meant round 2 onwards was always "at the cap"
 * (it is a multiple of it by then), leaving only the shape test — and since that
 * calls any text ending in a letter unfinished, every long answer continued until
 * it hit the round ceiling, long after the model had finished. Shape checks still
 * read the full text, because a code fence or `\begin` left open in an earlier
 * round is exactly the kind of genuinely-unfinished state worth continuing for.
 */
export function isTruncated(
  finishReason: string | null,
  roundText: string,
  maxTokens: number,
  fullText: string = roundText,
): boolean {
  if (finishReason) {
    // OpenAI: "length". Anthropic-style bridges: "max_tokens". Some shout it.
    return /^(length|max_tokens|maxtokens)$/i.test(finishReason);
  }
  if (!roundText.trim()) return false;
  if (!maxTokens || maxTokens <= 0) return false;
  // Well short of the cap ⇒ it stopped by choice, whatever the text looks like.
  if (estimateTokens(roundText) < maxTokens * 0.9) return false;
  return looksUnfinished(fullText);
}

/** Shape heuristics for "this text was interrupted rather than concluded". */
export function looksUnfinished(text: string): boolean {
  const t = text.trimEnd();
  if (!t) return false;
  // An odd number of ``` means a code block is still open.
  if ((t.match(/```/g) || []).length % 2 === 1) return true;
  // Unclosed display math.
  if ((t.match(/\$\$/g) || []).length % 2 === 1) return true;
  // An environment that was opened and never closed.
  if (/\\begin\{([a-z*]+)\}(?![\s\S]*\\end\{\1\})/i.test(t)) return true;
  // Ends mid-word, on a separator, or on an unfinished construct.
  if (/[a-zA-Z0-9,;:\-—([{\\]$/.test(t)) return true;
  return false;
}

/**
 * Strip the "I am continuing" opener a model adds when asked to resume.
 * Only ever applied to the first text of a continuation round.
 */
export function stripContinuationPreamble(text: string): string {
  return text.replace(
    /^\s*(?:(?:sure|ok(?:ay)?|certainly|of course)[,.!]?\s*)?(?:here(?:'s| is)\s+(?:the\s+)?(?:rest|remainder|continuation)\b[^\n]*?[.:]\s*|continu(?:ing|ed|e)\b[^\n]*?[.:]\s*|picking up\b[^\n]*?[.:]\s*)/i,
    "",
  );
}

/**
 * Longest suffix of `prev` that is also a prefix of `next`, so the repeated span
 * can be dropped. Bounded to the seam because scanning the whole accumulated
 * answer would be quadratic over many rounds.
 */
export function overlapLength(prev: string, next: string, window = OVERLAP_WINDOW): number {
  const tail = prev.slice(-window);
  const max = Math.min(tail.length, next.length);
  for (let n = max; n > 0; n--) {
    if (next.startsWith(tail.slice(tail.length - n))) return n;
  }
  return 0;
}

/**
 * Fallback for models that ignored the echo instruction, so there is no overlap to
 * key off. A cut at a token boundary usually lands mid-word, and BPE tokens carry
 * their leading space, so "no space" is the better default — a space is only added
 * where the text clearly starts something new.
 */
function seamNeedsSpace(prev: string, add: string): boolean {
  if (/\s$/.test(prev) || /^\s/.test(add)) return false;
  if (/[.,;:!?)\]}]$/.test(prev)) return true;
  if (/^[A-Z(\[{$\\#]/.test(add)) return true;
  return false;
}

/**
 * Join a continuation onto what we already have. Returns the *full* text, so the
 * caller can diff against its previous value to learn what to emit.
 */
export function joinContinuation(prev: string, next: string): string {
  let add = stripContinuationPreamble(next);
  if (!add.trim()) return prev;
  if (!prev) return add;

  const overlap = overlapLength(prev, add);
  if (overlap > 0) {
    // Exact seam — the model echoed the tail, so splice with no adjustment.
    add = add.slice(overlap);
    return add ? prev + add : prev;
  }
  return prev + (seamNeedsSpace(prev, add) ? " " : "") + add;
}
