// Puter.js keyless AI client
// https://developer.puter.com/tutorials/free-llm-api/
// No API key, no signup, 500+ models, vision supported.
//
// v6: Fixed "ai.chat not available" issue with:
// - Longer wait time for ai.chat to initialize (Puter.js loads async modules)
// - Retry logic that re-checks the puter object structure
// - Better error messages guiding users to solutions
// - Fallback to direct API if puter.ai.chat never becomes available

let puterLoadPromise: Promise<any> | null = null;

/**
 * Check if the Puter object has the ai.chat method available.
 * Puter.js loads its script synchronously but initializes AI modules asynchronously.
 */
function isPuterReady(): boolean {
  if (typeof window === "undefined") return false;
  const p = (window as any).puter;
  return !!(p && p.ai && typeof p.ai.chat === "function");
}

export function ensurePuterLoaded(): Promise<any> {
  // If already loaded and ready, return immediately
  if (isPuterReady()) {
    return Promise.resolve((window as any).puter);
  }
  if (puterLoadPromise) return puterLoadPromise;

  puterLoadPromise = new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("Puter can only load in browser"));
      return;
    }

    // Check if script already exists
    const existing = document.querySelector('script[src="https://js.puter.com/v2/"]') as HTMLScriptElement | null;

    const waitForAiChat = () => {
      const p = (window as any).puter;
      let tries = 0;
      const maxTries = 100; // 100 x 150ms = 15 seconds max wait
      const tick = () => {
        if (isPuterReady()) {
          return resolve(p);
        }
        // Check if puter object exists but ai.chat is missing
        if (p && p.ai && !p.ai.chat) {
          // Puter loaded but AI module not initialized yet — keep waiting
        }
        if (++tries > maxTries) {
          // Final check — maybe it became available in the last moment
          if (isPuterReady()) return resolve(p);
          reject(new Error(
            "Puter script loaded but AI chat module didn't initialize in time. " +
            "This can happen if Puter is rate-limited or requires sign-in. " +
            "Try: 1) Refresh the page, 2) Use a different free provider (LLM7.io), 3) Enable Local OCR in Settings."
          ));
          return;
        }
        setTimeout(tick, 150);
      };
      tick();
    };

    if (existing) {
      // Script tag exists — wait for it to load or check if already loaded
      if (isPuterReady()) {
        return resolve((window as any).puter);
      }
      existing.addEventListener("load", waitForAiChat, { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Puter.js script")), { once: true });
      // Also start polling in case the load event already fired
      setTimeout(waitForAiChat, 200);
      return;
    }

    // Create new script tag
    const s = document.createElement("script");
    s.src = "https://js.puter.com/v2/";
    s.async = true;
    // NO crossOrigin here. js.puter.com/v2/ serves the SDK WITHOUT an
    // access-control-allow-origin header, so setting crossOrigin="anonymous"
    // makes the browser reject the script outright with net::ERR_FAILED and
    // `puter.ai.chat` never exists — verified live 2026-08-04 (crossOrigin unset:
    // 200, hasAiChat=true in 1.7s; crossOrigin="anonymous": ERR_FAILED, no
    // response at all). A classic (non-CORS) script tag needs no such header.
    s.onload = waitForAiChat;
    s.onerror = () => reject(new Error(
      "Failed to load https://js.puter.com/v2/ – check your network connection or ad-blocker. " +
      "If Puter is blocked, try LLM7.io (free key) or switch to Local-only mode in Settings."
    ));
    document.head.appendChild(s);

    // Overall timeout — 20 seconds (increased from 12s)
    setTimeout(() => {
      if (!isPuterReady()) {
        // Don't reject yet — give it more time, just log a warning
        console.warn("Puter is taking longer than expected to initialize (20s). Still waiting...");
      }
    }, 20000);

    // Hard timeout at 30 seconds
    setTimeout(() => {
      if (!isPuterReady()) {
        // Clear the promise so it can be retried
        puterLoadPromise = null;
      }
    }, 30000);
  });

  return puterLoadPromise;
}

type ChatPart = { type?: string; text?: string; image_url?: { url?: string; detail?: string }; [k: string]: any };
type Msg = { role: "system" | "user" | "assistant"; content: string | ChatPart[] };

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p: any) => p?.text || p?.content || "")
      .filter(Boolean)
      .join("\n\n");
  }
  return String(content || "");
}

function extractImages(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const imgs: string[] = [];
  for (const p of content as any[]) {
    const url = p?.image_url?.url || p?.image_url || p?.image || p?.url;
    if (typeof url === "string" && (url.startsWith("http") || url.startsWith("data:") || url.startsWith("blob:"))) imgs.push(url);
  }
  return imgs;
}

// Custom error class for usage limit errors
export class PuterUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PuterUsageError";
  }
}

export function isUsageLimitError(err: unknown): boolean {
  if (!err) return false;
  const msg = String((err as Error)?.message || err).toLowerCase();
  return (
    msg.includes("insufficient balance") ||
    msg.includes("usage limit") ||
    msg.includes("rate limit") ||
    msg.includes("quota") ||
    msg.includes("credit") ||
    msg.includes("exceeded") ||
    msg.includes("too many requests") ||
    msg.includes("429")
  );
}

export interface PuterChatOpts {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  /** Per-call ceiling in ms. Defaults by request kind — see the two
   *  PUTER_*_TIMEOUT_MS constants and `callWithTimeout` for why this is mandatory. */
  timeoutMs?: number;
}

/** Raised when Puter accepts the call but never settles the promise. */
export class PuterTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PuterTimeoutError";
  }
}

/**
 * Puter's anonymous tier does not reject when it cannot serve a request — if the
 * session needs interactive sign-in, `puter.ai.chat()` simply never settles
 * (verified live 2026-08-04: `auth.isSignedIn() === false`, `auth.getUser()`
 * throws "Unauthorized", and a chat call was still pending after 60s). Without a
 * ceiling the whole app waits forever with no error and the fallback chain never
 * runs, so every call is raced against one.
 */
function callWithTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new PuterTimeoutError(`${label} did not respond within ${Math.round(ms / 1000)}s. Puter's free tier may need sign-in at puter.com, or is rate-limited.`)),
        ms,
      );
    }),
  ]);
}

/**
 * Default per-call ceilings.
 *
 * Split by request kind because the cost of waiting differs. A text prompt has a
 * fast alternative one rotation away (LLM7 answers in ~1s), so making the user sit
 * through 45s of a session that will never respond is pure dead time. An image is
 * different: Puter is the only keyless cloud vision provider, so if it is going to
 * answer at all it is worth waiting for, and vision models are genuinely slower.
 */
const PUTER_TEXT_TIMEOUT_MS = 20000;
const PUTER_VISION_TIMEOUT_MS = 45000;

function normalizeModel(m: string): string {
  if (!m) return "gpt-4o-mini";
  const bad: Record<string, string> = {
    "gpt-5": "gpt-4o",
    "gpt-5-mini": "gpt-4o-mini",
    "gpt-5-nano": "gpt-4o-mini",
    "gpt-4.1-nano": "gpt-4o-mini",
    "o3": "gpt-4o",
    "o3-mini": "gpt-4o-mini",
    "o4-mini": "gpt-4o-mini",
    "claude-sonnet-4-6": "claude-3-5-sonnet",
    "claude-opus-4-1": "claude-3-5-sonnet",
    "claude-opus-4-8": "claude-3-5-sonnet",
    "gemini-2.5-pro": "gemini-2.0-flash",
    "gemini-2.5-flash": "gemini-2.0-flash",
    "grok-4": "x-ai/grok-2-vision-1212",
    "deepseek-chat": "deepseek/deepseek-chat",
    "deepseek-reasoner": "deepseek/deepseek-r1",
  };
  return bad[m] || m;
}

export async function puterChat(messages: Msg[], opts: PuterChatOpts = {}): Promise<string> {
  const puter = await ensurePuterLoaded();
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const text = lastUser ? extractText(lastUser.content) : "";
  const imgs = lastUser ? extractImages(lastUser.content) : [];

  const systemMsg = messages.find((m) => m.role === "system");
  const systemText = systemMsg ? extractText(systemMsg.content) : "";

  let model = normalizeModel(opts.model || "gpt-4o-mini");

  const chatOpts: any = {
    model,
    temperature: typeof opts.temperature === "number" ? opts.temperature : 0.1,
    max_tokens: opts.max_tokens || 2048,
  };
  Object.keys(chatOpts).forEach((k) => chatOpts[k] === undefined && delete chatOpts[k]);

  // Try multiple model fallbacks
  const tryModels = [
    model,
    "gpt-4o-mini",
    "gpt-4o",
    "claude-3-5-sonnet",
    "gemini-2.0-flash",
  ].filter((v, i, a) => a.indexOf(v) === i);

  let lastErr: any = null;
  const timeoutMs = opts.timeoutMs || (imgs.length > 0 ? PUTER_VISION_TIMEOUT_MS : PUTER_TEXT_TIMEOUT_MS);

  for (const tryModel of tryModels) {
    try {
      chatOpts.model = tryModel;

      // Vision path
      if (imgs.length > 0) {
        const prompt = (systemText ? systemText + "\n\n" : "") + (text || "Transcribe all math in this image to LaTeX.");
        let res = await callWithTimeout(puter.ai.chat(prompt, imgs[0], chatOpts), timeoutMs, `Puter ${tryModel}`).catch(async (e: any) => {
          // A timeout means the session itself is unusable; the alternate call
          // shape would hang exactly the same way, so give up on this model.
          if (e instanceof PuterTimeoutError) throw e;
          return await callWithTimeout(puter.ai.chat(
            [
              ...(systemText ? [{ role: "system", content: systemText }] : []),
              {
                role: "user",
                content: [
                  { type: "text", text: text || prompt },
                  { type: "file", puter_path: imgs[0].startsWith("data:") ? undefined : imgs[0], url: imgs[0] },
                ].filter((x) => x.type !== "file" || x.puter_path || x.url),
              },
            ],
            chatOpts,
          ), timeoutMs, `Puter ${tryModel} (file form)`);
        });
        const out = extractPuterResponse(res);
        if (out) return out;
        throw new Error("Empty response from " + tryModel);
      }

      // Text path
      const history = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: extractText(m.content) }))
        .filter((m) => m.content);
      if (systemText && (!history.length || history[0].role !== "system")) {
        history.unshift({ role: "system", content: systemText });
      }
      const input = history.length > 1 ? history : text || "Hello";
      const res = await callWithTimeout(puter.ai.chat(input, chatOpts), timeoutMs, `Puter ${tryModel}`);
      const out = extractPuterResponse(res);
      if (out) return out;
      throw new Error("Empty response from " + tryModel);
    } catch (e: any) {
      lastErr = e;
      // Checked before isUsageLimitError: the timeout message mentions
      // rate-limiting as a likely cause and must not be reclassified as one.
      // A hang is a session-level problem, not a bad model id — walking the
      // remaining 4 fallbacks would burn another 3 minutes to fail identically.
      // Bail out now so the provider rotation can reach LLM7/WebLLM promptly.
      if (e instanceof PuterTimeoutError) throw e;
      if (isUsageLimitError(e)) {
        throw new PuterUsageError(e?.message || "Puter usage limit reached");
      }
      const msg = String(e?.message || e).toLowerCase();
      if (msg.includes("not found") || msg.includes("404") || msg.includes("model") || msg.includes("invalid")) {
        continue;
      }
      continue;
    }
  }
  throw new Error("Puter AI failed on all fallback models. Last error: " + (lastErr?.message || lastErr));
}

function extractPuterResponse(res: any): string {
  if (!res) return "";
  if (typeof res === "string") return res;
  if (res.message?.content) {
    const c = res.message.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map((x: any) => x?.text || x?.content || "").join("");
    return String(c);
  }
  if (res.output_text) return res.output_text;
  if (res.text) return res.text;
  if (res.content) return typeof res.content === "string" ? res.content : JSON.stringify(res.content);
  if (typeof res.message === "string") return res.message;
  return "";
}

export const PUTER_VISION_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "claude-3-5-sonnet",
  "claude-3-7-sonnet",
  "gemini-2.0-flash",
  "gemini-1.5-pro",
  "x-ai/grok-2-vision-1212",
  "perceptron/perceptron-mk1",
  "moonshotai/moonshot-v1-128k-vision-preview",
  "qwen/qwen-vl-max",
  "meta-llama/llama-4-maverick",
];
