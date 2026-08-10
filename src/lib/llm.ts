import type { ChatMessage, ModelDef, Provider, Settings } from "@/types";
import { cleanLatex } from "./mathRender";
import { ensurePuterLoaded, puterChat, isUsageLimitError, PuterTimeoutError } from "./puterClient";
import { duckduckgoChat, duckduckgoChatStream } from "./duckduckgoClient";
import { webllmChat, webllmChatStream, isWebLLMSupported } from "./webllmClient";
import { ggufChat, ggufChatStream, isGGUFLoaded, type GGUFMessage } from "./ggufClient";
import { FREE_FALLBACK_CHAIN, FREE_VISION_FALLBACK_CHAIN, isKeylessReachable, keylessFallbackModel } from "./providers";
import {
  MAX_CONTINUATION_ROUNDS,
  buildContinuePrompt,
  contextForContinuation,
  isTruncated,
  joinContinuation,
  MIN_CONTINUATION_PROGRESS,
} from "./continuation";
import { ThinkSplitter, splitThinking } from "./thinking";
import { fetchWithProxyFallback, isLocalhost } from "./corsProxy";
import { classifyModel, extractModelArray, mergeModels } from "./modelCaps";

export interface ChatArgs {
  provider: Provider;
  model: string;
  settings: Settings;
  systemPrompt?: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: unknown }>;
  signal?: AbortSignal;
  onProviderSwitch?: (newProviderId: string, reason: string, modelId?: string) => void;
  /**
   * Reports why the model stopped, when the provider tells us. Needed by the
   * auto-continuation loop to tell "ran out of tokens" apart from "finished".
   */
  onFinishReason?: (reason: string | null) => void;
}

/**
 * `Retry-After` is either a delta in seconds or an HTTP date. When it is absent
 * or unparseable, back off exponentially from 600ms so a shared free pool gets a
 * moment to drain without making the user wait noticeably.
 */
function parseRetryAfterMs(header: string | null, attempt: number): number {
  const fallback = 600 * Math.pow(2, attempt);
  if (!header) return fallback;
  const secs = Number(header.trim());
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const at = Date.parse(header);
  if (!Number.isNaN(at)) return Math.max(0, at - Date.now());
  return fallback;
}

/** Sleep that rejects as soon as the caller aborts, so a cancelled request does
 *  not sit out the full backoff before noticing. */
function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(t);
      reject(new Error("aborted"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function buildUrl(provider: Provider, _settings: Settings): string {
  const base = provider.baseUrl.replace(/\/+$/, "");
  // The manual proxy prefix is NOT applied here any more. It is one of the three
  // tiers in `lib/corsProxy` and is applied at fetch time, so that a prefix and
  // the automatic tiers cannot both wrap the same URL.
  return provider.chatPath.startsWith("http") ? provider.chatPath : base + provider.chatPath;
}

/**
 * Fetch with automatic CORS-proxy fallback.
 *
 * The tiering — same-origin serverless function, then a public pool, then the
 * user's manual prefix — lives in `lib/corsProxy`, which also documents why the
 * previous four-proxy list could not carry an authenticated POST and therefore
 * never worked. This is a thin adapter kept so the call sites below read the same
 * as before.
 */
async function fetchWithCORSFallback(
  url: string,
  init: RequestInit,
  opts: { allowProxy: boolean; isLocal: boolean; manualPrefix?: string; needsStream?: boolean },
): Promise<{ res: Response; proxied: boolean }> {
  const r = await fetchWithProxyFallback(url, init, {
    allowProxy: opts.allowProxy,
    isLocal: opts.isLocal,
    manualPrefix: opts.manualPrefix,
    needsStream: opts.needsStream,
    needsPost: (init.method || "GET").toUpperCase() !== "GET",
  });
  return { res: r.res, proxied: r.proxied };
}

function buildHeaders(provider: Provider): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = provider.apiKey?.trim();
  if (key && provider.authScheme !== "none") {
    if (provider.authScheme === "x-api-key") headers["x-api-key"] = key;
    else headers["Authorization"] = "Bearer " + key;
  }
  if (provider.id === "openrouter") {
    headers["HTTP-Referer"] = "https://mathorium.vercel.app";
    headers["X-Title"] = "Mathorium";
  }
  if (provider.id === "pollinations" || provider.id === "pollinations-free") {
    headers["Referer"] = "https://mathorium.vercel.app";
  }
  return headers;
}

/** ========== Pollinations FREE openai-compatible text endpoint ===========
 *  POST https://text.pollinations.ai/openai   (OpenAI-compatible, NO KEY)
 *  Also: GET https://text.pollinations.ai/{prompt}
 * ========================================================================
 */
async function pollinationsFreeChat(args: ChatArgs): Promise<string> {
  const { model, messages, settings } = args;

  const sys = (messages.find((m: any) => m.role === "system")?.content as string) || "";
  const lastUser = [...messages].reverse().find((m: any) => m.role === "user");
  let userText = "";
  let imageUrl = "";

  if (lastUser) {
    const c = lastUser.content;
    if (typeof c === "string") userText = c;
    else if (Array.isArray(c)) {
      for (const part of c as any[]) {
        if (part?.type === "text" && part.text) userText += (userText ? "\n\n" : "") + part.text;
        if (part?.type === "image_url" && part.image_url?.url) imageUrl = part.image_url.url;
      }
    }
  }

  const endpoints = [
    "https://text.pollinations.ai/openai",
    "https://text.pollinations.ai/v1/chat/completions",
  ];

  let lastErr: any = null;
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model || "openai",
          messages: [
            ...(sys ? [{ role: "system", content: sys }] : []),
            {
              role: "user",
              content: imageUrl
                ? [
                    { type: "text", text: userText || "Transcribe math to LaTeX." },
                    { type: "image_url", image_url: { url: imageUrl } },
                  ]
                : (userText || "Transcribe math to LaTeX."),
            },
          ],
          temperature: settings.temperature ?? 0,
          max_tokens: settings.maxTokens ?? 2048,
          stream: false,
        }),
        signal: args.signal,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        lastErr = new Error(`Pollinations ${endpoint} ${res.status} ${t.slice(0, 180)}`);
        continue;
      }
      const data = await res.json().catch(() => null);
      const content =
        data?.choices?.[0]?.message?.content ||
        data?.choices?.[0]?.text ||
        // gpt-oss-20b is a reasoning model and sometimes fills only this field.
        data?.choices?.[0]?.message?.reasoning_content ||
        data?.choices?.[0]?.message?.reasoning ||
        data?.content ||
        data?.response ||
        data?.output ||
        (typeof data === "string" ? data : "");
      if (content && String(content).trim()) return String(content);
      lastErr = new Error("Empty response from " + endpoint);
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  throw lastErr || new Error("Pollinations free endpoint failed");
}

/**
 * Decide if we should rotate to the next free provider based on the error.
 */
function shouldRotateProvider(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = (e.message || "").toLowerCase();
  // Usage / quota / rate limits
  if (isUsageLimitError(e)) return true;
  // Quota exhausted / credit required. Pollinations' Turnstile-gated anonymous
  // tier returns 402 for every prompt that misses its cache (verified
  // 2026-08-03), so without this a free user just sees the request fail.
  if (msg.includes("402") || msg.includes("payment required") || msg.includes("insufficient")) return true;
  // Auth errors on a "free" provider
  if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized") || msg.includes("forbidden")) return true;
  // Generic model / endpoint errors that suggest trying another provider
  if (msg.includes("not found") || msg.includes("404") || msg.includes("endpoint")) return true;
  // Bad request / model unavailable / upstream errors (LLM7.io returns 400 when models are down)
  if (msg.includes("400") || msg.includes("unavailable") || msg.includes("upstream") || msg.includes("rejected")) return true;
  // Internal server errors
  if (msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("504") || msg.includes("internal server")) return true;
  // Network errors when on a free provider
  if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("cors")) return true;
  // Empty response (Puter sometimes returns empty on exhausted balance)
  if (msg.includes("empty response")) return true;
  // Puter's anonymous tier hangs instead of rejecting when it needs interactive
  // sign-in (verified 2026-08-04), so puterClient races every call against a
  // ceiling and raises PuterTimeoutError. That is a provider-level failure like
  // any 401 and must rotate, or the user gets a dead end on the default provider.
  if (e instanceof PuterTimeoutError || msg.includes("did not respond within")) return true;
  return false;
}

/**
 * testConnection — test a specific provider WITHOUT the smart fallback chain.
 * Used by the Providers tab "Test connection" button to verify the actual
 * provider works, not whether a fallback exists.
 */
export async function testConnection(args: ChatArgs): Promise<string> {
  // Disable fallback for connection testing
  const testArgs: ChatArgs = {
    ...args,
    settings: { ...args.settings, autoFallback: false },
  };
  return chatCompletionSingle(testArgs);
}

/**
 * chatCompletion — main entry. Handles the smart fallback chain.
 * If the active provider fails AND autoFallback is enabled AND the active
 * provider is free (no key), rotate through the FREE_FALLBACK_CHAIN.
 */
export async function chatCompletion(args: ChatArgs): Promise<string> {
  const { provider, settings } = args;

  // Try the active provider first
  try {
    return await chatCompletionSingle(args);
  } catch (e: unknown) {
    if (!settings.autoFallback) throw e;
    if (!shouldRotateProvider(e)) throw e;

    // Only rotate among free providers
    const isFreeActive = provider.free || FREE_FALLBACK_CHAIN.includes(provider.id);
    if (!isFreeActive) throw e;

    // Detect if this is a vision request (image conversion)
    const hasImages = args.messages.some((m) => Array.isArray(m.content) && (m.content as any[]).some((p) => p?.type === "image_url"));
    // Use vision-only chain for image requests, full chain for text
    const activeChain = hasImages ? FREE_VISION_FALLBACK_CHAIN : FREE_FALLBACK_CHAIN;

    // Walk the chain in its declared order, skipping the provider that just
    // failed. The chain is ordered by measured reliability, not arbitrarily, so
    // rotating "from the next one after the failure" (the old behaviour) actively
    // hurt: with Puter selected it wrapped around to Pollinations — which 403s on
    // every keyless in-browser request — before reaching LLM7, which answers in a
    // second. Preferring the best remaining option is strictly better than
    // preferring the neighbouring one.
    const chain = activeChain.filter((pid) => pid !== provider.id);

    // Need the providers list — we don't have direct access here, so use DEFAULT_PROVIDERS via dynamic import
    const { DEFAULT_PROVIDERS, keylessSiblingModels } = await import("./providers");
    let lastErr = e;

    // Same provider, different model, before leaving for another host: a single
    // overloaded id should not cost the user the provider they chose.
    for (const sibling of keylessSiblingModels(provider, hasImages)) {
      if (sibling === args.model) continue;
      try {
        const result = await chatCompletionSingle({ ...args, model: sibling });
        args.onProviderSwitch?.(provider.id, `${args.model} failed on ${provider.id} — retried with ${sibling}`, sibling);
        return result;
      } catch (e2) {
        lastErr = e2;
        if (!shouldRotateProvider(e2)) break;
      }
    }
    for (const pid of chain) {
      // Skip the active provider (already tried)
      if (pid === provider.id) continue;
      const nextProvider = DEFAULT_PROVIDERS.find((p) => p.id === pid);
      if (!nextProvider) continue;

      // Skip WebLLM if not supported
      if (pid === "webllm" && !isWebLLMSupported()) continue;
      // Local GGUF can only answer once the user has loaded a file from disk.
      // Rotating into it before that would trade one error for another.
      if (pid === "gguf" && !isGGUFLoaded()) continue;

      // These come from DEFAULT_PROVIDERS and carry no user keys, so a provider
      // that genuinely needs one would only 401. LLM7 is reachable keyless on its
      // turbo ids, which `isKeylessReachable` accounts for.
      if (!isKeylessReachable(nextProvider)) continue;

      // On an image request a provider with no keyless vision model has nothing
      // to offer; trying it would send an empty model id and 400.
      const fallbackModel = keylessFallbackModel(nextProvider, hasImages);
      if (!fallbackModel) continue;

      try {
        const result = await chatCompletionSingle({
          ...args,
          provider: nextProvider,
          // Must resolve to a model the *keyless* tier can serve — the declared
          // visionDefault may be a paid id that would 401.
          model: fallbackModel,
        });
        args.onProviderSwitch?.(pid, `Auto-switched from ${provider.id} (failed) to ${pid} · ${fallbackModel}`, fallbackModel);
        return result;
      } catch (e2) {
        lastErr = e2;
        continue;
      }
    }
    throw lastErr;
  }
}

/** Single-provider attempt (no fallback) */
async function chatCompletionSingle(args: ChatArgs): Promise<string> {
  const { provider, model, settings, messages } = args;

  // ── Puter.js keyless path ───────────────────────────────────────────────
  if (provider.id === "puter" || provider.baseUrl.startsWith("puter://")) {
    await ensurePuterLoaded();
    return puterChat(messages as any, {
      model,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
    });
  }

  // ── Pollinations FREE (no API key) path ────────────────────────────────
  if (
    (provider.id === "pollinations" || provider.id === "pollinations-free") &&
    !provider.apiKey?.trim()
  ) {
    return pollinationsFreeChat(args);
  }

  // ── DuckDuckGo AI Chat path (text only) ────────────────────────────────
  if (provider.id === "duckduckgo" || provider.kind === "duckduckgo") {
    const flat = messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : extractTextFromContent(m.content),
    }));
    return duckduckgoChat(flat, {
      model,
      signal: args.signal,
    });
  }

  // ── WebLLM path (text only, in-browser) ────────────────────────────────
  if (provider.id === "webllm" || provider.kind === "webllm") {
    const flat = messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : extractTextFromContent(m.content),
    }));
    return webllmChat(flat, {
      model,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      signal: args.signal,
    });
  }

  // ── Local GGUF path (in-browser WASM; vision when an mmproj is loaded) ──
  // Unlike WebLLM the content parts are passed through rather than flattened:
  // ggufClient converts them and drops images itself when the loaded model has no
  // vision projector, so a VL model keeps its images here.
  if (provider.id === "gguf" || provider.kind === "gguf") {
    return ggufChat(messages as GGUFMessage[], {
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      signal: args.signal,
    });
  }

  // ── Standard OpenAI-compatible path ────────────────────────────────────
  const url = buildUrl(provider, settings);
  const headers = buildHeaders(provider);

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: settings.temperature,
    max_tokens: settings.maxTokens,
  };
  if (settings.detailLevel && messages.some((m) => Array.isArray(m.content))) {
    body.top_p = 1;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(15, settings.requestTimeout) * 1000,
  );
  const signal = args.signal
    ? mergeSignals(args.signal, controller.signal)
    : controller.signal;

  const manualPrefix = (settings.proxyPrefix || "").trim();
  const isLocal = isLocalhost(url);
  const allowProxy = settings.autoCorsProxy !== false && !isLocal;

  let res!: Response;

  // A 429 on a keyless shared pool is usually momentary rather than a real quota
  // wall: LLM7's turbo tier is one bucket for every anonymous caller, and
  // `codestral-latest` returned 429 on the first request of a session while
  // gpt-oss:20b and Llama-3.1-8B answered fine seconds either side of it (verified
  // live in-browser 2026-08-04). Rotating to another provider on that would throw
  // away a working model, so honour the server's own Retry-After for a couple of
  // short attempts first and only give up if it asks for longer than a provider
  // hop would cost.
  const MAX_429_RETRIES = 2;
  const MAX_429_WAIT_MS = 8000;

  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetchWithCORSFallback(
        url,
        { method: "POST", headers, body: JSON.stringify(body), signal },
        { allowProxy, isLocal, manualPrefix },
      );
      res = r.res;
    } catch (e: unknown) {
      clearTimeout(timeout);
      if ((e as Error)?.name === "AbortError") {
        throw new Error("Request timed out or was cancelled.");
      }
      if (provider.id === "pollinations") {
        try {
          return await pollinationsFreeChat(args);
        } catch {
          /* fall through */
        }
      }
      if (isLocal) {
        throw new Error(
          "Cannot reach " +
            provider.name +
            " at " +
            url +
            ". This is a browser CORS block (no website can bypass it). Fix it once:\n" +
            "  → Providers tab → Ollama → 🦙 Setup Helper (one-click auto-fix script + live test)\n" +
            '  or run: OLLAMA_ORIGINS="*" ollama serve  (then ollama pull <model>)\n' +
            "Make sure the server is running and the model is pulled.",
        );
      }
      throw new Error(
        "Network error reaching " +
          provider.name +
          " (likely a CORS block — the browser refused the connection). " +
          (allowProxy
            ? "Auto CORS-proxy fallback was tried but all public proxies failed. "
            : "") +
          "Solutions: enable Settings → 'Auto CORS proxy', or pick a CORS-friendly provider like Puter (no key) / Groq / OpenRouter / Gemini. (" +
          ((e as Error)?.message || "unknown") +
          ")",
      );
    }

    if (res.status !== 429 || attempt >= MAX_429_RETRIES) break;
    const waitMs = parseRetryAfterMs(res.headers.get("retry-after"), attempt);
    if (waitMs > MAX_429_WAIT_MS) break;
    try {
      await sleepWithSignal(waitMs, signal);
    } catch {
      throw new Error("Request timed out or was cancelled.");
    }
  }
  clearTimeout(timeout);

  if (!res.ok) {
    let detail = "";
    try {
      const data = await res.json();
      detail =
        data?.error?.message ||
        data?.error ||
        data?.message ||
        JSON.stringify(data);
    } catch {
      try {
        detail = await res.text();
      } catch {
        /* ignore */
      }
    }

    if ((res.status === 401 || res.status === 403) && provider.id === "pollinations") {
      try {
        return await pollinationsFreeChat(args);
      } catch (e2: any) {
        detail += " | free fallback also failed: " + (e2?.message || e2);
      }
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error(`Authentication failed (${res.status}) for ${provider.name}. ${detail}`);
    }
    if (res.status === 402) {
      throw new Error(`Payment required (${res.status}) for ${provider.name}. ${detail}`);
    }
    if (res.status === 429) {
      // Already retried up to MAX_429_RETRIES above, so this is a persistent
      // limit. shouldRotateProvider matches on it and moves to the next provider.
      throw new Error(`Rate limited (${res.status}) by ${provider.name} after retries. Slow down or switch model. ${detail}`);
    }
    if (res.status === 404) {
      if (provider.id === "pollinations") {
        try {
          return await pollinationsFreeChat(args);
        } catch {}
      }
      throw new Error(`Model/endpoint not found (${res.status}). Check the model id & base URL. ${detail}`);
    }
    throw new Error(`${provider.name} error ${res.status}: ${detail || res.statusText}`);
  }

  const data = await res.json();
  const msg0 = data?.choices?.[0]?.message;
  let content: unknown = msg0?.content;
  // Reasoning models sometimes put everything in a reasoning field and leave
  // `content` null — Pollinations' gpt-oss-20b does this, and DeepSeek-style
  // endpoints use `reasoning_content`. Treating that as a bad response shape
  // would surface an error for a reply that actually arrived, so fall back to
  // the reasoning text rather than throwing. Only used when there is no content;
  // a normal reply keeps its clean answer with the scratchpad discarded.
  if (typeof content !== "string" || !content.trim()) {
    const reasoning = msg0?.reasoning_content ?? msg0?.reasoning;
    if (typeof reasoning === "string" && reasoning.trim()) content = reasoning;
  }
  // Some providers return content as an array of parts instead of a string.
  if (Array.isArray(content)) content = extractTextFromContent(content);
  if (typeof content !== "string") {
    throw new Error("Unexpected response shape from " + provider.name + ".");
  }
  const fr = data?.choices?.[0]?.finish_reason ?? data?.choices?.[0]?.finishReason ?? null;
  args.onFinishReason?.(typeof fr === "string" ? fr : null);
  return content;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p: any) => p?.text || p?.content || "").filter(Boolean).join("\n\n");
  }
  return String(content || "");
}

// Merge an external abort signal (e.g. user cancel) with our timeout signal.
function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  a.addEventListener("abort", onAbort, { once: true });
  b.addEventListener("abort", onAbort, { once: true });
  if (a.aborted || b.aborted) controller.abort();
  return controller.signal;
}

/** Vision OCR: send an image (data URL) and ask for LaTeX. */
export async function convertImageToLatex(params: {
  provider: Provider;
  model: string;
  settings: Settings;
  dataUrl: string;
  mode: string;
  userInstruction?: string;
  signal?: AbortSignal;
  onProviderSwitch?: (newProviderId: string, reason: string, modelId?: string) => void;
}): Promise<string> {
  const { provider, model, settings, dataUrl, mode, userInstruction } = params;
  const detail = settings.detailLevel === "auto" ? "high" : settings.detailLevel;
  const instruction =
    userInstruction?.trim() ||
    (mode === "mixed"
      ? "Transcribe the page, preserving the order of text and math. Keep math in $...$ inline and $$...$$ display."
      : "Transcribe every distinct math expression, each on its own line wrapped in <math>...</math>.");

  const messages = [
    { role: "system", content: settings.systemPrompt },
    {
      role: "user",
      content: [
        { type: "text", text: instruction },
        { type: "image_url", image_url: { url: dataUrl, detail } },
      ],
    },
  ];

  return chatCompletion({
    provider,
    model,
    settings,
    messages: messages as ChatArgs["messages"],
    signal: params.signal,
    onProviderSwitch: params.onProviderSwitch,
  });
}

/**
 * Plain conversation: text + optional images.
 *
 * Auto-continues past the `max_tokens` cap just like the streaming path, so the
 * non-streaming mode is not the one that silently truncates.
 */
export async function chatReply(params: {
  provider: Provider;
  model: string;
  settings: Settings;
  history: ChatMessage[];
  signal?: AbortSignal;
  onProviderSwitch?: (newProviderId: string, reason: string, modelId?: string) => void;
  onContinue?: (round: number) => void;
  /** Chain-of-thought, split out of the answer. See the streaming twin. */
  onReasoning?: (delta: string) => void;
}): Promise<string> {
  const { provider, model, settings, history } = params;
  const messages: ChatArgs["messages"] = [];
  for (const m of history) {
    if (m.role === "system") {
      messages.push({ role: "system", content: m.content });
      continue;
    }
    if (m.images && m.images.length) {
      const parts: unknown[] = [{ type: "text", text: m.content }];
      for (const img of m.images) {
        parts.push({
          type: "image_url",
          image_url: { url: img, detail: settings.detailLevel },
        });
      }
      messages.push({ role: m.role, content: parts });
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  }

  const maxRounds = settings.autoContinue !== false ? MAX_CONTINUATION_ROUNDS : 0;
  let full = "";
  for (let round = 0; ; round++) {
    let finishReason: string | null = null;
    const part = await chatCompletion({
      provider,
      model,
      settings,
      messages:
        round === 0
          ? messages
          : [
              ...messages,
              { role: "assistant", content: contextForContinuation(full) },
              { role: "user", content: buildContinuePrompt(full) },
            ],
      signal: params.signal,
      onProviderSwitch: params.onProviderSwitch,
      onFinishReason: (r) => { finishReason = r; },
    });

    // Same treatment as the streaming path: a reasoning model's `<think>` block is not
    // part of the answer, and leaving it in would also poison the continuation context
    // that gets resent on the next round.
    const split = splitThinking(part);
    if (split.reasoning) params.onReasoning?.(split.reasoning);
    const clean = split.content;

    const prevFull = full;
    full = round === 0 ? clean : joinContinuation(full, clean);

    if (params.signal?.aborted) return full;
    if (round >= maxRounds) return full;
    // Judged on this round's own output — the cap is per completion, not per answer.
    if (!isTruncated(finishReason, clean, settings.maxTokens, full)) return full;
    // A round that added nothing (or only a pleasantry) means the model considers
    // itself done; asking again would just produce another one.
    if (round > 0 && full.length - prevFull.length < MIN_CONTINUATION_PROGRESS) return full;

    params.onContinue?.(round + 1);
  }
}

/**
 * Streaming chat: yields incremental text chunks for a live-typing feel.
 *
 * Also owns auto-continuation. A model that hits `max_tokens` stops mid-sentence
 * and reports `finish_reason: "length"`; rather than hand the user a truncated
 * answer, ask for the remainder and keep streaming until it stops for a real
 * reason. See ./continuation for the seam handling.
 */
export async function* chatReplyStream(params: {
  provider: Provider;
  model: string;
  settings: Settings;
  history: ChatMessage[];
  signal?: AbortSignal;
  onProviderSwitch?: (newProviderId: string, reason: string, modelId?: string) => void;
  /** Fired when a length-truncated answer is being continued (1-based round). */
  onContinue?: (round: number) => void;
  /**
   * Chain-of-thought deltas. Covers both conventions: a dedicated `reasoning` field
   * on the SSE delta, and inline `<think>…</think>` in the content, which is split out
   * here so the answer stream never carries it.
   */
  onReasoning?: (delta: string) => void;
}): AsyncGenerator<string, void, unknown> {
  // `provider` is not read here — it reaches the transport via `...params` below.
  const { settings, history } = params;

  // build messages
  const messages: ChatArgs["messages"] = [];
  for (const m of history) {
    if (m.role === "system") { messages.push({ role: "system", content: m.content }); continue; }
    if (m.images && m.images.length) {
      const parts: unknown[] = [{ type: "text", text: m.content }];
      for (const img of m.images) parts.push({ type: "image_url", image_url: { url: img, detail: settings.detailLevel } });
      messages.push({ role: m.role, content: parts });
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  }

  const autoContinue = settings.autoContinue !== false;
  const maxRounds = autoContinue ? MAX_CONTINUATION_ROUNDS : 0;
  /** Everything emitted so far, across all rounds. */
  let emitted = "";

  for (let round = 0; ; round++) {
    // Round 0 is the original request; later rounds append the partial answer and
    // ask for the rest.
    const roundMessages: ChatArgs["messages"] =
      round === 0
        ? messages
        : [
            ...messages,
            { role: "assistant", content: contextForContinuation(emitted) },
            { role: "user", content: buildContinuePrompt(emitted) },
          ];

    let finishReason: string | null = null;
    let roundText = "";
    /** How much answer existed before this round, to measure what the round added. */
    const emittedBefore = emitted.length;
    /**
     * On a continuation round the first stretch of text needs the seam repaired
     * (preamble stripped, echoed tail de-duplicated) before any of it can be
     * shown. Buffer just that much, then stream the rest straight through.
     */
    let seamPending = round > 0;
    let seamBuf = "";

    const gen = chatReplyStreamWithFallback({ ...params, messages: roundMessages });
    /**
     * Inline `<think>…</think>` is stripped here, upstream of everything else, so the
     * scratchpad never reaches the seam buffer, the continuation context, or the answer.
     * One splitter per round: the tags are balanced within a completion, and carrying
     * state across rounds would treat a fresh round as still inside a think block.
     */
    const splitter = new ThinkSplitter();
    const take = (raw: string): string => {
      const { content, reasoning } = splitter.push(raw);
      if (reasoning) params.onReasoning?.(reasoning);
      return content;
    };

    while (true) {
      const step = await gen.next();
      if (step.done) {
        finishReason = step.value ?? null;
        break;
      }
      const chunk = take(step.value);
      if (!chunk) continue;
      roundText += chunk;

      if (seamPending) {
        seamBuf += chunk;
        // Wait for enough text to spot an echoed tail, but never stall the UI if
        // the whole continuation is shorter than that.
        if (seamBuf.length < SEAM_BUFFER) continue;
        seamPending = false;
        const joined = joinContinuation(emitted, seamBuf);
        const delta = joined.slice(emitted.length);
        emitted = joined;
        if (delta) yield delta;
        continue;
      }

      emitted += chunk;
      yield chunk;
    }

    // Release anything the splitter was still holding as a possible partial tag.
    const tail = splitter.flush();
    if (tail.reasoning) params.onReasoning?.(tail.reasoning);
    if (tail.content) {
      roundText += tail.content;
      if (seamPending) seamBuf += tail.content;
      else { emitted += tail.content; yield tail.content; }
    }

    // Stream ended while still buffering the seam — flush what we have.
    if (seamPending) {
      const joined = joinContinuation(emitted, seamBuf);
      const delta = joined.slice(emitted.length);
      emitted = joined;
      if (delta) yield delta;
    }

    if (params.signal?.aborted) return;
    if (round >= maxRounds) return;
    // Judged on this round's own output — the cap is per completion, not per answer.
    if (!isTruncated(finishReason, roundText, settings.maxTokens, emitted)) return;
    // A round that added nothing new — blank, or only a pleasantry, or nothing but
    // the echoed tail — means the model considers itself done (or is stuck); either
    // way, continuing again would loop forever.
    if (round > 0 && emitted.length - emittedBefore < MIN_CONTINUATION_PROGRESS) return;

    params.onContinue?.(round + 1);
  }
}

/** How much of a continuation round to buffer before emitting, to repair the seam. */
const SEAM_BUFFER = 240;

/**
 * Streaming with provider rotation: try the active provider, and on a rotatable
 * error fall through the free chain (non-streaming, replayed word by word).
 */
async function* chatReplyStreamWithFallback(params: {
  provider: Provider;
  model: string;
  settings: Settings;
  messages: ChatArgs["messages"];
  signal?: AbortSignal;
  onProviderSwitch?: (newProviderId: string, reason: string, modelId?: string) => void;
  onReasoning?: (delta: string) => void;
}): AsyncGenerator<string, string | null, unknown> {
  const { provider, settings, messages } = params;

  /**
   * Whether any text has reached the caller.
   *
   * Rotating is only safe before that point. Once a chunk has been shown, the reply
   * on screen is a prefix of one model's answer, and restarting from another would
   * append a second beginning to it — so a mid-stream failure has to surface as an
   * error rather than silently produce a spliced answer.
   */
  let delivered = false;

  /** Run one attempt, marking delivery as soon as it produces anything. */
  async function* attempt(p: Parameters<typeof chatReplyStreamSingle>[0]) {
    const gen = chatReplyStreamSingle(p);
    while (true) {
      const step = await gen.next();
      if (step.done) return step.value ?? null;
      delivered = true;
      yield step.value;
    }
  }

  // Try streaming; on failure with auto-rotation, fall back to single-shot chat
  try {
    return yield* attempt({ ...params, messages });
  } catch (e: unknown) {
    if (!settings.autoFallback || !shouldRotateProvider(e) || delivered) throw e;

    // Try the fallback chain
    const { DEFAULT_PROVIDERS, keylessSiblingModels } = await import("./providers");
    const hasImages = messages.some((m) => Array.isArray(m.content) && (m.content as any[]).some((p) => p?.type === "image_url"));
    const activeChain = hasImages ? FREE_VISION_FALLBACK_CHAIN : FREE_FALLBACK_CHAIN;

    let lastErr = e;

    /**
     * Same provider, different model first — see the matching block in
     * chatCompletion. Streaming is retried (not downgraded to single-shot) because
     * a sibling id on a provider that streams will stream too, and the user should
     * not lose live output to an unrelated model's bad minute.
     */
    for (const sibling of keylessSiblingModels(provider, hasImages)) {
      if (sibling === params.model) continue;
      try {
        const fr = yield* attempt({ ...params, model: sibling, messages });
        params.onProviderSwitch?.(provider.id, `${params.model} failed on ${provider.id} — retried with ${sibling}`, sibling);
        return fr;
      } catch (e2) {
        lastErr = e2;
        if (delivered || !shouldRotateProvider(e2)) throw e2;
      }
    }
    // Declared order, minus the provider that just failed — see the matching
    // comment in chatCompletion: the chain is ranked, so wrapping around from the
    // failure point would try a known-broken provider ahead of a known-good one.
    const chain = activeChain.filter((pid) => pid !== provider.id);
    for (const pid of chain) {
      if (pid === provider.id) continue;
      const nextProvider = DEFAULT_PROVIDERS.find((p) => p.id === pid);
      if (!nextProvider) continue;
      if (pid === "webllm" && !isWebLLMSupported()) continue;
      if (pid === "gguf" && !isGGUFLoaded()) continue;
      // No user keys on DEFAULT_PROVIDERS — a provider that truly needs one would
      // only 401. LLM7's turbo ids work keyless, so it stays in the running.
      if (!isKeylessReachable(nextProvider)) continue;
      const fallbackModel = keylessFallbackModel(nextProvider, hasImages);
      if (!fallbackModel) continue;

      try {
        let fr: string | null = null;
        const full = await chatCompletionSingle({
          provider: nextProvider,
          model: fallbackModel,
          settings,
          messages,
          signal: params.signal,
          onFinishReason: (r) => { fr = r; },
        });
        params.onProviderSwitch?.(pid, `Auto-switched from ${provider.id} (streaming failed) to ${pid} · ${fallbackModel}`, fallbackModel);
        const words = full.match(/\S+\s*/g) || [full];
        for (const w of words) {
          if (params.signal?.aborted) return fr;
          yield w;
          await new Promise((r) => setTimeout(r, 8));
        }
        return fr;
      } catch (e2) {
        lastErr = e2;
        continue;
      }
    }
    throw lastErr;
  }
}

/**
 * Single-provider streaming attempt (no fallback).
 *
 * Returns the provider's `finish_reason` so the caller can tell a completed answer
 * from one that merely ran out of tokens. `null` means the provider never said.
 */
async function* chatReplyStreamSingle(params: {
  provider: Provider;
  model: string;
  settings: Settings;
  messages: ChatArgs["messages"];
  signal?: AbortSignal;
  /** Reasoning deltas from providers that send them in their own SSE field. */
  onReasoning?: (delta: string) => void;
}): AsyncGenerator<string, string | null, unknown> {
  const { provider, model, settings, messages } = params;

  // ── Puter streaming ─────────────────────────────────────────────────────
  if (provider.id === "puter" || provider.baseUrl.startsWith("puter://")) {
    await ensurePuterLoaded();
    const full = await puterChat(messages as any, { model, temperature: settings.temperature, max_tokens: settings.maxTokens });
    const words = full.match(/\S+\s*/g) || [full];
    for (const w of words) {
      if (params.signal?.aborted) return null;
      yield w;
      await new Promise((r) => setTimeout(r, 8));
    }
    return null; // Puter does not report finish_reason
  }

  // ── Pollinations free (no key) streaming ────────────────────────────────
  if ((provider.id === "pollinations" || provider.id === "pollinations-free") && !provider.apiKey?.trim()) {
    const full = await pollinationsFreeChat({
      provider, model, settings, messages,
      signal: params.signal,
    } as ChatArgs);
    const words = full.match(/\S+\s*/g) || [full];
    for (const w of words) { if (params.signal?.aborted) return null; yield w; await new Promise((r) => setTimeout(r, 8)); }
    return null;
  }

  // ── DuckDuckGo streaming ────────────────────────────────────────────────
  if (provider.id === "duckduckgo" || provider.kind === "duckduckgo") {
    const flat = messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : extractTextFromContent(m.content),
    }));
    yield* duckduckgoChatStream(flat, { model, signal: params.signal });
    return null;
  }

  // ── WebLLM streaming ────────────────────────────────────────────────────
  if (provider.id === "webllm" || provider.kind === "webllm") {
    const flat = messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : extractTextFromContent(m.content),
    }));
    return yield* webllmChatStream(flat, {
      model,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      signal: params.signal,
    });
  }

  // ── Local GGUF streaming ────────────────────────────────────────────────
  if (provider.id === "gguf" || provider.kind === "gguf") {
    return yield* ggufChatStream(messages as GGUFMessage[], {
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      signal: params.signal,
    });
  }

  // ── Standard OpenAI-compatible SSE streaming ────────────────────────────
  const url = buildUrl(provider, settings);
  const headers = buildHeaders(provider);
  const body: Record<string, unknown> = { model, messages, temperature: settings.temperature, max_tokens: settings.maxTokens, stream: true };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(20, settings.requestTimeout) * 1000);
  const signal = params.signal ? mergeSignals(params.signal, controller.signal) : controller.signal;

  let res: Response;
  try {
    const r = await fetchWithCORSFallback(
      url,
      { method: "POST", headers, body: JSON.stringify(body), signal },
      {
        allowProxy: settings.autoCorsProxy !== false && !isLocalhost(url),
        isLocal: isLocalhost(url),
        manualPrefix: (settings.proxyPrefix || "").trim(),
        // This response is consumed chunk-by-chunk, so a proxy that buffers would
        // turn live streaming into one lump at the end. Skip those here.
        needsStream: true,
      },
    );
    res = r.res;
  } catch (e) {
    clearTimeout(timeout);
    // fallback: non-streaming — reconstruct history-shaped params for chatReply
    let fr: string | null = null;
    const full = await chatCompletionSingle({
      provider,
      model,
      settings,
      messages,
      signal: params.signal,
      onFinishReason: (r) => { fr = r; },
    });
    const words = full.match(/\S+\s*/g) || [full];
    for (const w of words) { if (params.signal?.aborted) return fr; yield w; await new Promise((r) => setTimeout(r, 8)); }
    return fr;
  }
  clearTimeout(timeout);

  if (!res.ok || !res.body) {
    let fr: string | null = null;
    const full = await chatCompletionSingle({
      provider,
      model,
      settings,
      messages,
      signal: params.signal,
      onFinishReason: (r) => { fr = r; },
    });
    const words = full.match(/\S+\s*/g) || [full];
    for (const w of words) { if (params.signal?.aborted) return fr; yield w; await new Promise((r) => setTimeout(r, 8)); }
    return fr;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finishReason: string | null = null;
  /**
   * Reasoning models stream their scratchpad in `delta.reasoning` (Pollinations,
   * OpenRouter) or `delta.reasoning_content` (DeepSeek-style) and the answer in
   * `delta.content`. The scratchpad is reported through `onReasoning` so the UI can
   * show it in its own panel, separate from the answer.
   *
   * It is also buffered, because some models emit reasoning only and never produce
   * any content — without the flush at the end that would render as a blank reply.
   */
  let sawContent = false;
  let reasoningBuf = "";
  try {
    while (true) {
      if (params.signal?.aborted) { reader.cancel(); return finishReason; }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") {
          if (!sawContent && reasoningBuf) yield reasoningBuf;
          return finishReason;
        }
        try {
          const json = JSON.parse(data);
          const choice = json?.choices?.[0];
          // Arrives on the final chunk; "length" is what drives auto-continuation.
          const fr = choice?.finish_reason ?? choice?.finishReason;
          if (typeof fr === "string" && fr) finishReason = fr;
          const delta = choice?.delta?.content || choice?.text || "";
          if (delta) { sawContent = true; yield delta; continue; }
          const reasoning = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning;
          if (typeof reasoning === "string" && reasoning) {
            params.onReasoning?.(reasoning);
            if (!sawContent) reasoningBuf += reasoning;
          }
        } catch {
          /* skip malformed chunk */
        }
      }
    }
  } finally {
    try { reader.cancel(); } catch {}
  }
  if (!sawContent && reasoningBuf) yield reasoningBuf;
  return finishReason;
}

export async function fetchModelList(
  provider: Provider,
  settings: Settings,
  opts: { merge?: boolean } = {},
): Promise<ModelDef[]> {
  const endpoint = (provider.modelsPath || "").trim() || defaultModelsPath(provider);
  if (!endpoint) {
    throw new Error(
      `${provider.name} has no model-list endpoint. ` +
        (provider.kind && provider.kind !== "openai" && provider.kind !== "custom"
          ? "This provider is not an HTTP API — its models are fixed."
          : "Add one in the Models endpoint field, e.g. https://…/v1/models"),
    );
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (provider.apiKey?.trim()) {
    if (provider.authScheme === "x-api-key") headers["x-api-key"] = provider.apiKey.trim();
    else headers["Authorization"] = "Bearer " + provider.apiKey.trim();
  }

  let res: Response;
  try {
    const r = await fetchWithCORSFallback(
      endpoint,
      { headers },
      {
        allowProxy: settings.autoCorsProxy !== false && !isLocalhost(endpoint),
        isLocal: isLocalhost(endpoint),
        manualPrefix: (settings.proxyPrefix || "").trim(),
      },
    );
    res = r.res;
  } catch (e: unknown) {
    throw new Error(
      "Could not reach the model list — " +
        ((e as Error)?.message || "network/CORS error") +
        ". If this provider blocks browser calls, turn Auto CORS proxy ON in Settings.",
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 401/403 on a model list almost always means "no key", which is a different
    // problem from "endpoint is wrong" and deserves a different instruction.
    const hint =
      res.status === 401 || res.status === 403
        ? " — this endpoint needs an API key. Paste one above, then fetch again."
        : res.status === 404
          ? " — check the Models endpoint URL."
          : "";
    throw new Error(`Model list failed (${res.status} ${res.statusText})${hint} ${body.slice(0, 160)}`.trim());
  }

  const data = await res.json();
  const live = extractModelArray(data)
    .map((m) => classifyModel(m, provider))
    .filter((m): m is NonNullable<typeof m> => m !== null);

  if (!live.length) throw new Error("The endpoint answered, but listed no usable chat models.");

  // Merging keeps the curated ⭐ recommendations and their hand-written notes,
  // which no endpoint reports, while picking up everything the provider has added
  // since. Callers that genuinely want the raw list pass merge:false.
  return opts.merge === false ? live : mergeModels(provider.models || [], live);
}

/**
 * The conventional `/models` endpoint for a provider that has none configured.
 *
 * Every OpenAI-compatible API exposes `GET {baseUrl}/models`, so for the great
 * majority this is derivable rather than something the user should have to look
 * up. The exceptions are listed explicitly: providers whose catalogue lives at a
 * different path, and the non-HTTP kinds (in-browser WebLLM, a GGUF file on disk,
 * Puter's SDK) where there is no endpoint to call at all.
 */
export function defaultModelsPath(provider: Provider): string {
  // These do not speak HTTP — their model lists are fixed in code.
  if (provider.kind && !["openai", "custom", "pollinations"].includes(provider.kind)) return "";

  switch (provider.id) {
    // OpenRouter publishes its whole catalogue with pricing and modalities, and
    // needs no key for it — which is what makes free/vision auto-detection exact
    // there rather than a guess from the model name.
    case "openrouter":
    case "openrouter-free":
      return "https://openrouter.ai/api/v1/models";
    case "huggingface":
      return "https://router.huggingface.co/v1/models";
    case "ollama":
      return provider.baseUrl.replace(/\/v1\/?$/, "") + "/api/tags";
    default:
      break;
  }

  const base = provider.baseUrl.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) return "";
  return base + "/models";
}

export { cleanLatex };
