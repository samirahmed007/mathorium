// Local GGUF — llama.cpp compiled to WebAssembly, via wllama.
//
// The model never leaves the machine: the user picks a .gguf file from disk with a
// file input and it is handed to WASM as a Blob. No upload, no API key, no network
// call at inference time. The only thing fetched is wllama's 7.6 MB wasm binary,
// pulled from jsDelivr the same way WebLLM's runtime is — bundling it would break
// the single-file build for a feature most users never touch.
//
// Docs: https://github.com/ngxson/wllama

// Type-only: erased at build time, so the 358 kB runtime is not pulled into the
// main chunk by the mere act of typing this file.
import type {
  Wllama,
  ChatCompletionMessage,
  ChatCompletionMessageContent,
  ChatCompletionChunk,
  LoadModelParams,
} from "@wllama/wllama/esm/index.js";

/** wllama's own CDN path for the matching wasm build. Pinned to the installed version. */
const WASM_URL = "https://cdn.jsdelivr.net/npm/@wllama/wllama@3.5.1/esm/wasm/wllama.wasm";

/** A 32-bit WASM heap tops out at 4 GB, and the KV cache has to fit alongside the weights. */
const SIZE_WARN_BYTES = 3.0 * 1024 * 1024 * 1024;

export interface GGUFModelInfo {
  /** File name of the main shard, e.g. "Qwen3VL-4B-Instruct-Q4_K_M.gguf". */
  name: string;
  /** Total bytes across all shards, excluding the mmproj. */
  size: number;
  /** True when an mmproj was loaded *and* the model actually accepts images. */
  vision: boolean;
  /** Context length the model was loaded with. */
  contextSize: number;
}

let modPromise: Promise<typeof import("@wllama/wllama/esm/index.js")> | null = null;
let engine: Wllama | null = null;
let loadPromise: Promise<GGUFModelInfo> | null = null;
let info: GGUFModelInfo | null = null;
/** Identity of the currently-loaded file set, so re-picking the same model is a no-op. */
let loadedKey: string | null = null;

function loadWllama() {
  // The package declares `main: "index.js"`, which does not exist at the package
  // root — only `index.ts` does. Importing the bare specifier therefore resolves to
  // uncompiled TypeScript that drags in the whole source tree. The published build
  // is under esm/, so address it directly.
  if (!modPromise) modPromise = import("@wllama/wllama/esm/index.js");
  return modPromise;
}

export function isGGUFSupported(): boolean {
  return typeof WebAssembly !== "undefined";
}

/** True when the browser is cross-origin isolated, which is what unlocks threads. */
export function isMultiThreadAvailable(): boolean {
  return typeof SharedArrayBuffer !== "undefined" && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}

/** A warning to show before loading, or null when the file is comfortably sized. */
export function sizeWarning(files: File[]): string | null {
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total < SIZE_WARN_BYTES) return null;
  return (
    `This model is ${(total / 1024 ** 3).toFixed(1)} GB. WebAssembly can address at most 4 GB, ` +
    `and the context cache needs room too — loading may fail or the tab may run out of memory. ` +
    `A smaller quantisation (Q4_K_M or below) is safer.`
  );
}

/** Split a picked file list into the model shards and the optional mmproj. */
export function classifyFiles(files: File[]): { model: File[]; mmproj: File | null } {
  const mmproj = files.find((f) => /mmproj/i.test(f.name)) ?? null;
  const model = files
    .filter((f) => f !== mmproj)
    // Multi-shard models are named `-00001-of-00003.gguf`; they must load in order.
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { model, mmproj };
}

const keyOf = (files: File[]) =>
  files.map((f) => `${f.name}:${f.size}:${f.lastModified}`).sort().join("|");

export interface LoadOptions {
  /** Context window. Larger costs memory quadratically in the KV cache. */
  contextSize?: number;
  onProgress?: (fraction: number, status: string) => void;
  params?: LoadModelParams;
}

/**
 * Load a GGUF model from user-picked files.
 *
 * An mmproj file may be included in `files`; wllama inspects each blob's GGUF
 * metadata and routes it to the vision projector automatically, so the caller does
 * not have to tell them apart beyond the file picker accepting more than one file.
 */
export async function loadGGUFModel(files: File[], opts: LoadOptions = {}): Promise<GGUFModelInfo> {
  if (!isGGUFSupported()) throw new Error("This browser has no WebAssembly support, so local GGUF models cannot run.");
  if (!files.length) throw new Error("No model file selected.");

  const key = keyOf(files);
  if (info && loadedKey === key) return info;
  if (loadPromise && loadedKey === key) return loadPromise;

  const { onProgress } = opts;
  loadedKey = key;

  loadPromise = (async (): Promise<GGUFModelInfo> => {
    // Switching models: free the old one first. Two multi-gigabyte models will not
    // coexist in a 4 GB address space.
    if (engine) {
      try {
        await engine.exit();
      } catch {
        /* the old engine is being discarded either way */
      }
      engine = null;
      info = null;
    }

    onProgress?.(0.05, "Starting the WebAssembly runtime…");
    const { Wllama } = await loadWllama();

    const wllama = new Wllama({ default: WASM_URL }, { suppressNativeLog: true });

    const { model, mmproj } = classifyFiles(files);
    if (!model.length) throw new Error("The selection contains only an mmproj file — pick the model .gguf as well.");

    onProgress?.(0.15, `Loading ${model[0].name}…`);

    const blobs: Blob[] = mmproj ? [...model, mmproj] : model;
    await wllama.loadModel(blobs, {
      n_ctx: opts.contextSize ?? 4096,
      // Reserve a core or two for the UI; a saturated thread pool makes the page
      // unresponsive while tokens stream.
      n_threads: Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 2)),
      ...opts.params,
    });

    engine = wllama;

    const ctx = wllama.getLoadedContextInfo();
    info = {
      name: model[0].name,
      size: model.reduce((n, f) => n + f.size, 0),
      // Ask the engine rather than assuming: an mmproj that does not match the model
      // is loaded without complaint but leaves image input unavailable.
      vision: wllama.supportInputModality("image") && !!ctx.has_image_input,
      contextSize: ctx.n_ctx,
    };

    onProgress?.(1, "Ready");
    return info;
  })();

  try {
    return await loadPromise;
  } catch (e) {
    // A failed load must not leave a key that makes the next attempt a cache hit.
    loadedKey = null;
    loadPromise = null;
    engine = null;
    info = null;
    throw e;
  }
}

export function getGGUFModelInfo(): GGUFModelInfo | null {
  return info;
}

export function isGGUFLoaded(): boolean {
  return !!engine?.isModelLoaded();
}

export function ggufSupportsVision(): boolean {
  return info?.vision ?? false;
}

export async function unloadGGUF(): Promise<void> {
  if (engine) {
    try {
      await engine.exit();
    } catch {
      /* ignore */
    }
  }
  engine = null;
  info = null;
  loadPromise = null;
  loadedKey = null;
}

// ── Chat ─────────────────────────────────────────────────────────────────────

/** The app's message shape: text, or OpenAI-style content parts with images. */
export type GGUFMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
};

export interface GGUFChatOpts {
  temperature?: number;
  max_tokens?: number;
  signal?: AbortSignal;
}

/** Decode a `data:` URL into the raw bytes wllama wants. */
function dataUrlToArrayBuffer(url: string): ArrayBuffer {
  const comma = url.indexOf(",");
  if (comma < 0) throw new Error("Malformed data URL in an image message.");
  const bin = atob(url.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Translate the app's OpenAI-shaped messages into wllama's.
 *
 * The two disagree about images: OpenAI takes `{type:'image_url', image_url:{url}}`
 * with a data URL, wllama takes `{type:'image', data: ArrayBuffer}`. Images are
 * dropped for text-only models rather than passed through as unusable text, so a
 * non-vision GGUF still answers the words of a question asked alongside a picture.
 */
function toWllamaMessages(messages: GGUFMessage[], allowImages: boolean): ChatCompletionMessage[] {
  return messages.map((m): ChatCompletionMessage => {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content } as ChatCompletionMessage;
    }

    const text = m.content
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text)
      .join("\n");

    if (m.role !== "user") {
      return { role: m.role, content: text } as ChatCompletionMessage;
    }

    const images = allowImages
      ? m.content
          .filter((p) => p.type === "image_url" && p.image_url?.url?.startsWith("data:"))
          .map((p): ChatCompletionMessageContent => ({ type: "image", data: dataUrlToArrayBuffer(p.image_url!.url) }))
      : [];

    if (!images.length) return { role: "user", content: text };

    return {
      role: "user",
      content: [...images, { type: "text", text } as ChatCompletionMessageContent],
    };
  });
}

function requireEngine(): Wllama {
  if (!engine || !engine.isModelLoaded()) {
    throw new Error("No local model is loaded. Pick a .gguf file in Settings → Local GGUF first.");
  }
  return engine;
}

export async function ggufChat(messages: GGUFMessage[], opts: GGUFChatOpts = {}): Promise<string> {
  const wllama = requireEngine();
  const res = await wllama.createChatCompletion({
    messages: toWllamaMessages(messages, ggufSupportsVision()),
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.max_tokens ?? 2048,
    abortSignal: opts.signal,
    stream: false,
  });
  return res.choices[0]?.message?.content ?? "";
}

/**
 * Streaming completion. Yields text deltas and returns the finish reason, matching
 * the WebLLM generator's contract so `llm.ts` can auto-continue a truncated answer.
 */
export async function* ggufChatStream(
  messages: GGUFMessage[],
  opts: GGUFChatOpts = {},
): AsyncGenerator<string, string | null, unknown> {
  const wllama = requireEngine();

  const stream = await wllama.createChatCompletion({
    messages: toWllamaMessages(messages, ggufSupportsVision()),
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.max_tokens ?? 2048,
    abortSignal: opts.signal,
    stream: true,
  });

  let finishReason: string | null = null;
  for await (const chunk of stream as AsyncIterable<ChatCompletionChunk>) {
    if (opts.signal?.aborted) return finishReason;
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    const delta = choice?.delta?.content;
    if (delta) yield delta;
  }
  return finishReason;
}
