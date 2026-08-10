// WebLLM — fully in-browser LLM via WebGPU.
// No API key, no signup, no network calls after model download.
// Docs: https://github.com/mlc-ai/web-llm
//
// This client lazily loads the @mlc-ai/web-llm package via dynamic import
// from a CDN (so we don't bundle 5 MB into our single-file build).
// The first chat call downloads the model (~2-4 GB) — the user must consent.

let enginePromise: Promise<any> | null = null;
let activeModel: string | null = null;
let engineInstance: any = null;

async function loadWebLLMModule(): Promise<any> {
  // Load @mlc-ai/web-llm from a CDN ESM build
  // (so it doesn't bloat the main bundle and only loads when user picks WebLLM)
  const mod = await import(/* @vite-ignore */ "https://esm.sh/@mlc-ai/web-llm@0.2.78");
  return mod;
}

export function isWebLLMSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  return !!(navigator as any).gpu;
}

export async function ensureWebLLMEngine(modelId: string, onProgress?: (p: number) => void): Promise<any> {
  if (engineInstance && activeModel === modelId) return engineInstance;
  if (enginePromise && activeModel === modelId) return enginePromise;

  if (!isWebLLMSupported()) {
    throw new Error(
      "WebLLM requires WebGPU support. Use Chrome 113+, Edge 113+, or Safari 18+. Firefox doesn't support WebGPU yet.",
    );
  }

  // If switching models, reload
  if (engineInstance && activeModel !== modelId) {
    try {
      await engineInstance.unload();
    } catch {
      /* ignore */
    }
    engineInstance = null;
    activeModel = null;
  }

  enginePromise = (async () => {
    const mod = await loadWebLLMModule();
    const CreateMLCEngine = mod.CreateMLCEngine || mod.default?.CreateMLCEngine;
    if (!CreateMLCEngine) throw new Error("Could not load WebLLM engine factory.");

    engineInstance = await CreateMLCEngine(modelId, {
      initProgressCallback: (info: any) => {
        if (onProgress && typeof info.progress === "number") {
          onProgress(info.progress);
        }
      },
    });
    activeModel = modelId;
    return engineInstance;
  })();

  return enginePromise;
}

type Msg = { role: "system" | "user" | "assistant"; content: string };

export interface WebLLMChatOpts {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  signal?: AbortSignal;
  onProgress?: (p: number) => void;
}

/**
 * WebLLM chat — non-streaming.
 * Returns the assistant's text reply.
 */
export async function webllmChat(messages: Msg[], opts: WebLLMChatOpts = {}): Promise<string> {
  const modelId = opts.model || "Llama-3.2-3B-Instruct-q4f32_1-MLC";
  const engine = await ensureWebLLMEngine(modelId, opts.onProgress);

  const req = {
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.max_tokens ?? 2048,
    stream: false,
  };

  const res = await engine.chat.completions.create(req);
  return res.choices?.[0]?.message?.content || "";
}

/**
 * WebLLM chat — streaming generator.
 * Yields incremental text chunks; returns the finish reason when the engine
 * reports one, so the caller can auto-continue a length-truncated answer.
 */
export async function* webllmChatStream(
  messages: Msg[],
  opts: WebLLMChatOpts = {},
): AsyncGenerator<string, string | null, unknown> {
  const modelId = opts.model || "Llama-3.2-3B-Instruct-q4f32_1-MLC";
  const engine = await ensureWebLLMEngine(modelId, opts.onProgress);

  const req = {
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.max_tokens ?? 2048,
    stream: true,
  };

  let finishReason: string | null = null;
  const chunkStream = await engine.chat.completions.create(req);
  for await (const chunk of chunkStream) {
    if (opts.signal?.aborted) {
      try {
        await engine.interruptGenerate();
      } catch {
        /* ignore */
      }
      return finishReason;
    }
    const choice = chunk.choices?.[0];
    if (typeof choice?.finish_reason === "string" && choice.finish_reason) {
      finishReason = choice.finish_reason;
    }
    const delta = choice?.delta?.content || "";
    if (delta) yield delta;
  }
  return finishReason;
}

export function getActiveWebLLMModel(): string | null {
  return activeModel;
}

export async function unloadWebLLM(): Promise<void> {
  if (engineInstance) {
    try {
      await engineInstance.unload();
    } catch {
      /* ignore */
    }
  }
  engineInstance = null;
  activeModel = null;
  enginePromise = null;
}
