// DuckDuckGo AI Chat — free, anonymous, no API key, no signup.
// Endpoint: https://duckduckgo.com/duckchat/v1/chat
// Requires an x-vqd-4 token fetched from https://duckduckgo.com/duckchat/v1/status
//
// IMPORTANT LIMITATIONS:
// - Text only (NO vision/image support) — cannot be used for math OCR
// - Requires CORS proxy in browser (DuckDuckGo does not send CORS headers)
// - Public CORS proxies may strip the x-vqd-4 header, making this unreliable
// - Anonymous, rate-limited per IP
// - This provider is a LAST-RESORT text fallback. For reliable text chat, use Puter or LLM7.io.

const DDG_BASE = "https://duckduckgo.com/duckchat/v1";
const DDG_STATUS_URL = DDG_BASE + "/status";

// Public CORS proxies — tried in order. Some strip headers, some don't.
const CORS_PROXIES: ((u: string) => string)[] = [
  (u) => "https://corsproxy.io/?url=" + encodeURIComponent(u),
  (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  (u) => "https://proxy.cors.sh/" + u,
  (u) => "https://thingproxy.freeboard.io/fetch/" + u,
  (u) => "https://api.codetabs.com/v1/proxy/?quest=" + encodeURIComponent(u),
];

// Token cache — the x-vqd-4 token can be reused for a few requests.
let vqd4Token: string | null = null;
let tokenExpiry = 0;

async function fetchWithProxies(url: string, init: RequestInit = {}): Promise<Response> {
  // Try direct first (will fail in browser due to CORS, but try anyway)
  try {
    const res = await fetch(url, init);
    if (res.ok || (res.status >= 400 && res.status < 500)) return res;
  } catch {
    // fall through to proxies
  }
  // Try CORS proxies in order
  let lastErr: unknown;
  for (const make of CORS_PROXIES) {
    try {
      const proxiedUrl = make(url);
      const res = await fetch(proxiedUrl, init);
      if (res.ok || (res.status >= 400 && res.status < 500)) return res;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error("DuckDuckGo: all CORS proxies failed (DuckDuckGo blocks direct browser calls). Try Puter or LLM7.io instead. Last error: " + (lastErr instanceof Error ? lastErr.message : String(lastErr)));
}

async function fetchVqd4Token(): Promise<string> {
  if (vqd4Token && Date.now() < tokenExpiry) return vqd4Token;
  const res = await fetchWithProxies(DDG_STATUS_URL, {
    method: "GET",
    headers: {
      "x-vqd-accept": "1",
    },
  });
  if (!res.ok) {
    throw new Error("DuckDuckGo: status fetch failed (" + res.status + "). CORS proxy may be down.");
  }
  // Try to get token from headers
  let token = res.headers.get("x-vqd-4");
  if (!token) {
    // Some proxies put response headers in a different format or strip them.
    // Try allorigins-style header format
    token = res.headers.get("X-Vqd-4") || res.headers.get("x-vqd-4".toLowerCase());
  }
  if (!token) {
    // Last resort: try parsing from body (some proxies return headers in body)
    try {
      const txt = await res.text();
      const m = txt.match(/x-vqd-4[:\s]+([A-Za-z0-9\-_]+)/i);
      if (m) token = m[1];
    } catch {
      /* ignore */
    }
  }
  if (!token) {
    throw new Error("DuckDuckGo: x-vqd-4 token not found (CORS proxy stripped headers). DuckDuckGo is unreliable in browser — use Puter or LLM7.io for reliable text chat.");
  }
  vqd4Token = token;
  tokenExpiry = Date.now() + 5 * 60 * 1000; // 5 min
  return vqd4Token;
}

type Msg = { role: "system" | "user" | "assistant"; content: string };

export interface DuckChatOpts {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  signal?: AbortSignal;
}

/**
 * DuckDuckGo AI Chat — non-streaming.
 * Returns the assistant's text reply.
 * NOTE: Unreliable in browser due to CORS. May fail often.
 */
export async function duckduckgoChat(messages: Msg[], opts: DuckChatOpts = {}): Promise<string> {
  const token = await fetchVqd4Token();
  const model = opts.model || "gpt-4o-mini";

  // DuckDuckGo does not accept a system message; fold it into the first user message.
  const sysMsg = messages.find((m) => m.role === "system");
  const history = messages.filter((m) => m.role !== "system");
  if (sysMsg && history.length > 0 && history[0].role === "user") {
    history[0] = {
      ...history[0],
      content: sysMsg.content + "\n\n" + history[0].content,
    };
  }

  const body = {
    model,
    messages: history.map((m) => ({ role: m.role, content: m.content })),
  };

  const res = await fetchWithProxies(DDG_BASE + "/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-vqd-4": token,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) {
    // Token may have expired — clear and retry once
    if (res.status === 429 || res.status === 401) {
      vqd4Token = null;
      tokenExpiry = 0;
    }
    const txt = await res.text().catch(() => "");
    throw new Error("DuckDuckGo chat failed: " + res.status + " " + txt.slice(0, 200));
  }

  // DuckDuckGo returns SSE stream even for non-streaming requests.
  const reader = res.body?.getReader();
  if (!reader) {
    const txt = await res.text();
    return parseDdgSseText(txt);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        if (json.message) out += json.message;
        else if (json.choices?.[0]?.delta?.content) out += json.choices[0].delta.content;
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

function parseDdgSseText(txt: string): string {
  let out = "";
  for (const line of txt.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (data === "[DONE]") continue;
    try {
      const json = JSON.parse(data);
      if (json.message) out += json.message;
    } catch {
      /* skip */
    }
  }
  return out;
}

/**
 * DuckDuckGo AI Chat — streaming generator.
 * Yields incremental text chunks.
 */
export async function* duckduckgoChatStream(
  messages: Msg[],
  opts: DuckChatOpts = {},
): AsyncGenerator<string, void, unknown> {
  const token = await fetchVqd4Token();
  const model = opts.model || "gpt-4o-mini";

  const sysMsg = messages.find((m) => m.role === "system");
  const history = messages.filter((m) => m.role !== "system");
  if (sysMsg && history.length > 0 && history[0].role === "user") {
    history[0] = {
      ...history[0],
      content: sysMsg.content + "\n\n" + history[0].content,
    };
  }

  const body = {
    model,
    messages: history.map((m) => ({ role: m.role, content: m.content })),
  };

  const res = await fetchWithProxies(DDG_BASE + "/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-vqd-4": token,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    // Fallback: non-streaming
    const full = await duckduckgoChat(messages, opts);
    const words = full.match(/\S+\s*/g) || [full];
    for (const w of words) {
      if (opts.signal?.aborted) return;
      yield w;
      await new Promise((r) => setTimeout(r, 8));
    }
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (opts.signal?.aborted) {
        reader.cancel();
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const json = JSON.parse(data);
          if (json.message) yield json.message;
          else if (json.choices?.[0]?.delta?.content) yield json.choices[0].delta.content;
        } catch {
          /* skip */
        }
      }
    }
  } finally {
    try {
      reader.cancel();
    } catch {
      /* ignore */
    }
  }
}
