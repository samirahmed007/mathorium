/**
 * Separate a reasoning model's chain of thought from its answer.
 *
 * Two conventions are in the wild and a model may use either:
 *
 *  1. A dedicated field — `delta.reasoning` (Pollinations, OpenRouter) or
 *     `delta.reasoning_content` (DeepSeek-style). Handled at the SSE layer.
 *  2. Inline tags in the content itself — `<think>…</think>`, which MiniMax, Qwen,
 *     DeepSeek-R1 and most open reasoning models emit. Handled here.
 *
 * Left alone, the second kind renders the entire scratchpad in the answer bubble, which
 * is why a MiniMax reply looked like it was thinking out loud at the user.
 *
 * Splitting has to be incremental. Text arrives in arbitrary chunks, so a tag routinely
 * straddles a boundary: one chunk ends `…<thi`, the next starts `nk>…`. Matching on
 * whole chunks would miss that and leak the tag. So a possible partial tag is held back
 * until the next chunk proves what it is.
 */

const OPEN_TAGS = ["<think>", "<thinking>", "<reasoning>", "<reflection>"];
const CLOSE_TAGS = ["</think>", "</thinking>", "</reasoning>", "</reflection>"];

/** Longest tag, so we know how much trailing text could still be an incomplete one. */
const MAX_TAG = Math.max(...[...OPEN_TAGS, ...CLOSE_TAGS].map((t) => t.length));

export interface SplitChunk {
  /** Answer text, safe to show. */
  content: string;
  /** Chain-of-thought text, for the thinking panel. */
  reasoning: string;
}

/**
 * Could `s` be the start of `tag`, cut short? Used to decide whether to hold text back:
 * a trailing `<thi` is ambiguous until more arrives, but a trailing `<x` never will be.
 */
function isPrefixOfAny(s: string, tags: string[]): boolean {
  return tags.some((t) => t.length > s.length && t.startsWith(s));
}

/** Index of the earliest occurrence of any tag, with which one it was. */
function firstOf(hay: string, tags: string[], from: number): { at: number; tag: string } | null {
  let best: { at: number; tag: string } | null = null;
  for (const tag of tags) {
    const at = hay.indexOf(tag, from);
    if (at !== -1 && (!best || at < best.at)) best = { at, tag };
  }
  return best;
}

/**
 * Stateful splitter for one streamed response.
 *
 * Feed it chunks in order; each call returns whatever became unambiguous. Call `flush`
 * at the end to release any text held back for a tag that never completed.
 */
export class ThinkSplitter {
  /** Text seen but not yet classifiable, because it may be a partial tag. */
  private held = "";
  /** True between an open tag and its close. */
  private inside = false;

  push(chunk: string): SplitChunk {
    let buf = this.held + chunk;
    this.held = "";
    let content = "";
    let reasoning = "";

    for (;;) {
      const hit = firstOf(buf, this.inside ? CLOSE_TAGS : OPEN_TAGS, 0);
      if (!hit) break;
      // Everything before the tag belongs to whichever side we are currently on.
      if (this.inside) reasoning += buf.slice(0, hit.at);
      else content += buf.slice(0, hit.at);
      buf = buf.slice(hit.at + hit.tag.length);
      this.inside = !this.inside;
    }

    /**
     * A tail that could still grow into a tag is held back rather than emitted. Only the
     * last `MAX_TAG - 1` characters can be a partial tag, and only from the last `<`.
     */
    const lastOpen = buf.lastIndexOf("<");
    if (lastOpen !== -1 && buf.length - lastOpen < MAX_TAG) {
      const tail = buf.slice(lastOpen);
      if (isPrefixOfAny(tail, this.inside ? CLOSE_TAGS : OPEN_TAGS)) {
        this.held = tail;
        buf = buf.slice(0, lastOpen);
      }
    }

    if (this.inside) reasoning += buf;
    else content += buf;
    return { content, reasoning };
  }

  /** Release anything still held. A tag left open means the rest was all reasoning. */
  flush(): SplitChunk {
    const rest = this.held;
    this.held = "";
    return this.inside ? { content: "", reasoning: rest } : { content: rest, reasoning: "" };
  }
}

/**
 * Split a complete (non-streamed) string in one go — the same rules, for the
 * single-shot path and for text that was already accumulated.
 */
export function splitThinking(text: string): SplitChunk {
  const s = new ThinkSplitter();
  const a = s.push(text);
  const b = s.flush();
  return { content: a.content + b.content, reasoning: a.reasoning + b.reasoning };
}
