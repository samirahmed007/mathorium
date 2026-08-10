import type { ModelDef, Provider, Settings } from "@/types";
import { fetchWithProxyFallback, isLocalhost } from "./corsProxy";
import { ensurePuterLoaded } from "./puterClient";

/**
 * Image generation, across every engine the app can actually reach from a page.
 *
 * Three routes exist, and which one a request takes is decided by the engine's
 * `kind` rather than by the caller:
 *
 *   pollinations — a GET whose response *is* the picture. No key, no account, no
 *                  CORS problem, because an <img> can display the URL even when
 *                  script is not allowed to read it. This is the default for the
 *                  same reason it always was: it is the only one that works for a
 *                  user who has configured nothing at all.
 *   openai       — POST {baseUrl}/images/generations, the OpenAI Images shape that
 *                  Together, DeepInfra, Nebius, OpenAI and most others implement.
 *                  Needs whatever key the provider needs; runs through the CORS
 *                  proxy chain like every other provider call.
 *   puter        — puter.ai.txt2img() from the SDK the app already loads for chat.
 *                  Free, but tied to a Puter account, so it is offered rather than
 *                  defaulted to.
 *
 * PERCHANCE, and why it is a hand-off rather than an engine
 * ---------------------------------------------------------
 * perchance.org's AI image generator is genuinely free and unlimited, so it was
 * worth trying to embed. It cannot be, and the blocks are deliberate rather than
 * incidental — measured live 2026-08-08 (`scripts/imagegen-probe.mjs --live`):
 *
 *   1. `image-generation.perchance.org/api/generate` sends no
 *      `Access-Control-Allow-Origin`, so the browser refuses to read the response
 *      from any origin but Perchance's own. From this app the fetch throws
 *      `TypeError: Failed to fetch` before a byte is parsed.
 *   2. It requires a `userKey` minted by their ad-supported page behind a
 *      Cloudflare bot challenge; requests without one answer
 *      `{"status":"invalid_key"}`, and the challenge cannot be satisfied from
 *      inside someone else's page.
 *   3. perchance.org serves `X-Frame-Options: sameorigin`, so it cannot be put in
 *      an iframe either, and its page reads no `?prompt=` parameter, so even a
 *      pop-up cannot be pre-filled through the URL.
 *
 * Every working third-party Perchance integration is a *server* that drives a
 * headless browser to harvest a key and re-serves the result with its own CORS
 * headers. That is exactly the "third-party proxy the user has to run separately"
 * this app set out to avoid, and it breaks whenever Perchance changes. So instead
 * of a broken engine in the list, `perchanceHandoff` copies the prompt and opens
 * their generator in a tab — one paste from a picture, honest about what it is.
 * If Perchance ever opens CORS, the probe's expected-failure check flips to a
 * failure and tells us this can become a real engine.
 */

export interface GenImageOpts {
  prompt: string;
  width?: number;
  height?: number;
  seed?: number;
  /** Engine id from `listImageEngines`. */
  model?: string;
  enhance?: boolean;
  nologo?: boolean;
  negativePrompt?: string;
  /** URL or data URL for image-to-image. */
  referenceImage?: string;
  /** Needed to route anything but the keyless built-ins. */
  providers?: Provider[];
  settings?: Settings;
  signal?: AbortSignal;
}

export interface GenImageResult {
  url: string;
  provider: string;
  model: string;
  seed: number;
  w: number;
  h: number;
  note?: string;
  isImageToImage?: boolean;
}

export type ImageEngineKind = "pollinations" | "openai" | "puter";

export interface ImageEngine {
  /** Unique across providers: `${providerId}::${modelId}`, or a bare id for built-ins. */
  id: string;
  label: string;
  kind: ImageEngineKind;
  /** Which provider supplies it, for the picker's option groups. */
  providerId: string;
  providerName: string;
  free: boolean;
  /** Usable right now — a paid provider with no key saved is not. */
  ready: boolean;
  supportsImg2Img: boolean;
  note?: string;
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

/**
 * Engines that need nothing configured.
 *
 * Live check 2026-08-08: `image.pollinations.ai/models` still returns exactly
 * `["sana"]`, and requesting any other id with the same prompt+seed returns a
 * byte-identical JPEG — the `model` parameter is ignored. Listing six engines
 * that all draw the same picture would be a lie, so there is one entry.
 */
export const BUILTIN_IMAGE_ENGINES: ImageEngine[] = [
  {
    id: "sana",
    label: "Sana — free, no key ⭐",
    kind: "pollinations",
    providerId: "pollinations",
    providerName: "Pollinations",
    free: true,
    ready: true,
    supportsImg2Img: true,
    note: "Keyless and unlimited. Works with nothing configured.",
  },
  {
    id: "puter:txt2img",
    label: "DALL·E 3 via Puter — free with account",
    kind: "puter",
    providerId: "puter",
    providerName: "Puter",
    free: true,
    ready: true,
    supportsImg2Img: false,
    note: "Free, but Puter asks you to sign in the first time. Sign-in is a pop-up from puter.com.",
  },
];

/** Legacy alias — the picker used to read this name. */
export const FREE_IMAGE_MODELS = BUILTIN_IMAGE_ENGINES;

/**
 * Every engine available given what the user has configured.
 *
 * The provider entries come from models the live-model fetch tagged `imageGen`
 * (see `lib/modelCaps`), which is why a provider that adds FLUX next month shows
 * up here after one "Fetch live" without this file being touched.
 *
 * Engines whose provider has no key are still listed, marked `ready: false`, so
 * the picker can say "add a key" instead of silently having a shorter list than
 * the provider's own docs promise.
 */
export function listImageEngines(providers: Provider[] = []): ImageEngine[] {
  const out: ImageEngine[] = [...BUILTIN_IMAGE_ENGINES];

  for (const p of providers) {
    // Only OpenAI-shaped HTTP providers have an /images/generations endpoint.
    // Puter, WebLLM, a local GGUF file and DuckDuckGo do not, and Pollinations
    // is already represented by its built-in entry.
    if (p.kind && p.kind !== "openai" && p.kind !== "custom") continue;
    for (const m of p.models || []) {
      if (!(m as ModelDef & { imageGen?: boolean }).imageGen) continue;
      const needsKey = !p.free && !p.apiKey?.trim();
      out.push({
        id: `${p.id}::${m.id}`,
        label: `${(m.label || m.id).replace(/\s*\(image gen\)\s*$/i, "")} · ${p.name}`,
        kind: "openai",
        providerId: p.id,
        providerName: p.name,
        free: m.free ?? p.free ?? false,
        ready: !needsKey,
        supportsImg2Img: false,
        note: needsKey ? `Add your ${p.name} API key in Providers to use this.` : m.note,
      });
    }
  }

  // Free and ready first: the list is a menu, and the entries that cost nothing
  // and work immediately are the ones most users want.
  return out.sort((a, b) => Number(b.ready) - Number(a.ready) || Number(b.free) - Number(a.free));
}

export const IMAGE_PRESETS = [
  { id: "1:1", w: 1024, h: 1024, label: "Square 1024²" },
  { id: "16:9", w: 1280, h: 720, label: "Wide 16:9" },
  { id: "9:16", w: 720, h: 1280, label: "Tall 9:16" },
  { id: "4:3", w: 1024, h: 768, label: "Classic 4:3" },
  { id: "3:2", w: 1080, h: 720, label: "Photo 3:2" },
  { id: "2:3", w: 720, h: 1080, label: "Portrait 2:3" },
];

// ---------------------------------------------------------------------------
// Perchance hand-off
// ---------------------------------------------------------------------------

export const PERCHANCE_URL = "https://perchance.org/ai-text-to-image-generator";

/**
 * Open Perchance with the prompt on the clipboard.
 *
 * Not an engine — see the header for why it cannot be one. Returns whether the
 * copy succeeded so the caller can say "prompt copied" or "paste it yourself"
 * truthfully; `navigator.clipboard` is unavailable on insecure pages and can be
 * refused outright.
 */
export async function perchanceHandoff(prompt: string): Promise<{ copied: boolean }> {
  let copied = false;
  try {
    await navigator.clipboard.writeText(prompt);
    copied = true;
  } catch {
    /* insecure context or permission refused — the tab still opens */
  }
  window.open(PERCHANCE_URL, "_blank", "noopener,noreferrer");
  return { copied };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function pollinationsUrl(o: Required<Pick<GenImageOpts, "prompt" | "width" | "height" | "seed" | "nologo" | "enhance">> & { referenceImage?: string; negativePrompt?: string }): string {
  const p = encodeURIComponent(o.prompt.slice(0, 1800));
  const params = new URLSearchParams({
    width: String(o.width),
    height: String(o.height),
    seed: String(o.seed),
    model: "sana",
    nologo: o.nologo ? "true" : "false",
  });
  if (o.enhance) params.set("enhance", "true");
  if (o.negativePrompt?.trim()) params.set("negative_prompt", o.negativePrompt.trim());
  if (o.referenceImage) params.set("image", o.referenceImage);
  return `https://image.pollinations.ai/prompt/${p}?${params.toString()}`;
}

/**
 * The OpenAI Images route.
 *
 * `b64_json` is requested rather than a URL because a provider-hosted URL usually
 * expires within the hour, and a conversation that shows blank squares tomorrow
 * is worse than one that carries its pictures with it. Providers that ignore the
 * parameter and return a URL anyway are handled too.
 */
async function generateViaProvider(
  engine: ImageEngine,
  modelId: string,
  o: Required<Pick<GenImageOpts, "prompt" | "width" | "height" | "seed">> & { negativePrompt?: string },
  providers: Provider[],
  settings: Settings | undefined,
  signal?: AbortSignal,
): Promise<string> {
  const provider = providers.find((p) => p.id === engine.providerId);
  if (!provider) throw new Error(`Provider "${engine.providerName}" is no longer configured.`);
  if (!provider.free && !provider.apiKey?.trim()) {
    throw new Error(`${provider.name} needs an API key. Add one in the Providers tab, then try again.`);
  }

  const url = provider.baseUrl.replace(/\/+$/, "") + "/images/generations";
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  const key = provider.apiKey?.trim();
  if (key) {
    if (provider.authScheme === "x-api-key") headers["x-api-key"] = key;
    else headers["Authorization"] = "Bearer " + key;
  }

  const body: Record<string, unknown> = {
    model: modelId,
    prompt: o.prompt,
    n: 1,
    size: `${o.width}x${o.height}`,
    response_format: "b64_json",
    seed: o.seed,
  };
  if (o.negativePrompt?.trim()) body.negative_prompt = o.negativePrompt.trim();

  const { res } = await fetchWithProxyFallback(
    url,
    { method: "POST", headers, body: JSON.stringify(body), signal },
    {
      allowProxy: settings?.autoCorsProxy !== false && !isLocalhost(url),
      isLocal: isLocalhost(url),
      manualPrefix: (settings?.proxyPrefix || "").trim(),
      needsPost: true,
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text.slice(0, 200);
    try {
      const j = JSON.parse(text);
      detail = j?.error?.message || j?.message || detail;
    } catch { /* not JSON — the raw text is the best available detail */ }
    const hint =
      res.status === 401 || res.status === 403
        ? " — check the API key in Providers."
        : res.status === 404
          ? ` — ${provider.name} may not offer an /images/generations endpoint.`
          : res.status === 429
            ? " — rate limited; wait a moment or switch engine."
            : "";
    throw new Error(`${provider.name} image generation failed (${res.status})${hint} ${detail}`.trim());
  }

  const data = await res.json();
  const first = data?.data?.[0] ?? data?.images?.[0] ?? data?.output?.[0];
  const b64 = first?.b64_json ?? first?.b64 ?? (typeof first === "string" && !/^https?:/.test(first) ? first : "");
  if (b64) return `data:image/png;base64,${b64}`;
  const remote = first?.url ?? (typeof first === "string" ? first : "");
  if (remote) return remote;
  throw new Error(`${provider.name} replied without an image. Its /images/generations response shape is not recognised.`);
}

/** The Puter SDK route. */
async function generateViaPuter(prompt: string, signal?: AbortSignal): Promise<string> {
  const puter = await ensurePuterLoaded();
  if (typeof puter?.ai?.txt2img !== "function") {
    throw new Error("Puter's image generator is unavailable — puter.ai.txt2img is missing from the loaded SDK.");
  }
  // Puter's SDK has no abort and no timeout: when the account is not signed in it
  // simply never settles (measured — no answer after 90s). A race turns that into
  // an error the user can act on instead of a spinner that runs forever.
  const result = await Promise.race([
    puter.ai.txt2img(prompt),
    new Promise<never>((_, reject) => {
      const t = setTimeout(
        () => reject(new Error("Puter did not answer within 90s. Its image generator needs a signed-in puter.com account — sign in there, or pick the keyless Sana engine.")),
        90_000,
      );
      signal?.addEventListener("abort", () => { clearTimeout(t); reject(new Error("Cancelled.")); }, { once: true });
    }),
  ]);
  const src = (result as HTMLImageElement)?.src ?? String(result ?? "");
  if (!src) throw new Error("Puter returned no image.");
  return src;
}

export async function generateImage(opts: GenImageOpts): Promise<GenImageResult> {
  const prompt = opts.prompt.trim() || "a beautiful abstract math fractal";
  const width = opts.width || 1024;
  const height = opts.height || 1024;
  const seed = opts.seed ?? Math.floor(Math.random() * 1_000_000_000);
  const id = opts.model || "sana";
  const providers = opts.providers ?? [];

  const engine =
    listImageEngines(providers).find((e) => e.id === id) ??
    BUILTIN_IMAGE_ENGINES.find((e) => e.id === id) ??
    BUILTIN_IMAGE_ENGINES[0];

  const isImg2Img = !!opts.referenceImage && engine.supportsImg2Img;

  if (engine.kind === "puter") {
    const url = await generateViaPuter(prompt, opts.signal);
    return { url, provider: "Puter", model: engine.id, seed, w: width, h: height };
  }

  if (engine.kind === "openai") {
    const modelId = engine.id.split("::")[1] || engine.id;
    const url = await generateViaProvider(
      engine,
      modelId,
      { prompt, width, height, seed, negativePrompt: opts.negativePrompt },
      providers,
      opts.settings,
      opts.signal,
    );
    return { url, provider: engine.providerName, model: modelId, seed, w: width, h: height };
  }

  const url = pollinationsUrl({
    prompt,
    width,
    height,
    seed,
    nologo: opts.nologo ?? true,
    enhance: opts.enhance ?? false,
    negativePrompt: opts.negativePrompt,
    referenceImage: isImg2Img ? opts.referenceImage : undefined,
  });

  // A HEAD-like pre-fetch confirms the picture rendered, but its failure proves
  // nothing: the URL still displays in an <img>, which is not subject to CORS.
  // So a failed check downgrades to a note rather than an error.
  try {
    const res = await fetch(url, { mode: "cors", signal: opts.signal });
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 1024 && blob.type.startsWith("image/")) {
        return { url, provider: "Pollinations", model: "sana", seed, w: width, h: height, isImageToImage: isImg2Img };
      }
    }
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
  }

  return {
    url,
    provider: "Pollinations",
    model: "sana",
    seed,
    w: width,
    h: height,
    note: isImg2Img ? "Image-to-image via Pollinations (reference image attached)." : "Rendered via direct Pollinations URL.",
    isImageToImage: isImg2Img,
  };
}

/** Re-roll with a new seed but the same prompt, size and engine. */
export function rerollImage(g: {
  prompt: string;
  w: number;
  h: number;
  model: string;
  referenceImage?: string;
  providers?: Provider[];
  settings?: Settings;
}): Promise<GenImageResult> {
  return generateImage({
    prompt: g.prompt,
    width: g.w,
    height: g.h,
    model: g.model,
    seed: Math.floor(Math.random() * 1_000_000_000),
    referenceImage: g.referenceImage,
    providers: g.providers,
    settings: g.settings,
  });
}

/** Download an image URL, falling back to opening it when the bytes are unreadable. */
export async function downloadImage(url: string, filename: string) {
  // A data: URL is already the bytes — fetching it would just decode and re-encode.
  if (url.startsWith("data:")) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 200);
    return;
  }
  try {
    const res = await fetch(url, { mode: "cors" });
    if (res.ok) {
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);
      }, 200);
      return;
    }
  } catch {
    /* fall through */
  }
  // CORS refused the read — the browser can still show it in its own tab.
  window.open(url, "_blank", "noopener");
}
