import type { ModelDef, Provider } from "@/types";

/**
 * Work out what a model can do from whatever a provider's `/models` endpoint
 * chose to tell us.
 *
 * The problem this solves: every provider returns a different shape. OpenRouter
 * hands back rich metadata (input modalities, per-token pricing, context length);
 * Groq and DeepSeek return a bare OpenAI `{id, object, created}` triple; Ollama
 * uses `{name, details}` under `models`; Pollinations returns its own array of
 * objects with `vision` and `tier` fields. A live list is only useful if the app
 * can still say "this one takes images" and "this one costs nothing" afterwards,
 * so metadata is used where it exists and the id is read where it does not.
 *
 * Reading the id is a heuristic and will occasionally be wrong. That is fine for
 * `vision`: guessing wrong only means the Convert tab offers a model that then
 * refuses the image, which is recoverable and visible. It is deliberately NOT
 * fine for pricing — see `detectFree`, which never upgrades a model to free on
 * the strength of its name alone.
 */

// ---------------------------------------------------------------------------
// Capability patterns
// ---------------------------------------------------------------------------

/**
 * Model families that accept image input.
 *
 * Ordered roughly by how common they are in the free tiers this app targets.
 * `\bvl\b` and friends are anchored so `qwen2.5-vl` matches but `vllm` does not.
 */
const VISION_PATTERNS: RegExp[] = [
  /\bvision\b/i,
  /(^|[-_/])vl([-_.]|\d|$)/i, // qwen2.5-vl, internvl, glm-4v… (the "VL" convention)
  /\bllava\b/i,
  /\bpixtral\b/i,
  /\bmoondream\b/i,
  /\bflorence\b/i,
  /\bidefics\b/i,
  /\bmolmo\b/i,
  /\bjanus\b/i,
  /minicpm[-_]?v/i,
  /internvl/i,
  /deepseek[-_]?vl/i,
  /\bgpt-4o\b/i,
  /\bgpt-4\.1\b/i,
  /\bgpt-5/i,
  /\bo[134]\b/i, // o1 / o3 / o4 reasoning models are multimodal
  /\bgemini\b/i,
  /\bgemma-3\b/i, // Gemma 3 is multimodal; Gemma 2 is not
  /\bllama-?4\b/i, // Llama 4 Scout / Maverick
  /llama-?3\.2-(11|90)b/i, // only the 11B/90B Llama 3.2 are vision
  /\bclaude-3/i,
  /\bclaude-(sonnet|opus|haiku)/i,
  /phi-4?-multimodal/i,
  /\bstep-1v\b/i,
  /yi-vision/i,
  /nova-(lite|pro)/i,
  /grok-.*vision/i,
  /\bmultimodal\b/i,
];

/**
 * Endpoints that are not chat completions at all.
 *
 * `/models` is a catalogue of everything the provider hosts, so it routinely
 * includes embedding, reranking, speech and moderation models. Listing those in
 * a chat model picker is worse than listing nothing: the user selects one, the
 * request 400s, and the app looks broken. Filtered out entirely.
 */
const NON_CHAT_PATTERNS: RegExp[] = [
  /embed/i,
  /rerank/i,
  /whisper/i,
  /\btts\b/i,
  /text-to-speech/i,
  /speech/i,
  /transcribe/i,
  /\bmoderation\b/i,
  /guard/i, // llama-guard, prompt-guard — classifiers, not chat
  /^bge-/i,
  /^e5-/i,
  /\bclip\b/i,
  /\bvoice\b/i,
  /\baudio\b/i,
  /\bocr\b/i,
];

/**
 * Image *generation* models. These are real and useful — they just belong in the
 * Generate Image picker rather than the chat picker, so they are tagged instead
 * of dropped. See `lib/imageGen`.
 */
const IMAGE_GEN_PATTERNS: RegExp[] = [
  /dall-?e/i,
  /\bflux\b/i,
  /stable-?diffusion/i,
  /\bsdxl\b/i,
  /\bsana\b/i,
  /kontext/i,
  /\bimagen\b/i,
  /gpt-image/i,
  /seedream/i,
  /qwen-image/i,
  /nano-?banana/i,
  /\bmidjourney\b/i,
  /\bplayground-v/i,
  /\bkolors\b/i,
];

/** Models that expose a chain of thought, so the UI can show a thinking panel. */
const REASONING_PATTERNS: RegExp[] = [
  /\bo[134]\b/i,
  /\br1\b/i,
  /reason/i,
  /\bthinking\b/i,
  /deepseek-r/i,
  /\bqwq\b/i,
  /magistral/i,
  /\bthink\b/i,
];

function matchesAny(s: string, pats: RegExp[]): boolean {
  return pats.some((p) => p.test(s));
}

// ---------------------------------------------------------------------------
// Field extraction — the shapes providers actually return
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}
function obj(v: unknown): Raw {
  return v && typeof v === "object" ? (v as Raw) : {};
}

/** The id, under whichever key this provider used. */
function detectId(m: Raw): string {
  return (
    str(m.id) ||
    str(m.name) || // Ollama `/api/tags`, Pollinations
    str(m.model) ||
    str(m.canonical_slug) ||
    ""
  );
}

/**
 * Does this model take images?
 *
 * Metadata wins when present — `input_modalities` from OpenRouter and `vision`
 * from Pollinations are authoritative and specific, whereas the id is a guess.
 * Only when a provider tells us nothing (Groq, DeepSeek, Cerebras, OpenAI all
 * return a bare id) do we fall back to pattern-matching the name.
 */
function detectVision(m: Raw, id: string): boolean {
  if (typeof m.vision === "boolean") return m.vision;

  const arch = obj(m.architecture);
  const modalities = [
    ...(Array.isArray(arch.input_modalities) ? arch.input_modalities : []),
    ...(Array.isArray(m.input_modalities) ? m.input_modalities : []),
    ...(Array.isArray(m.modalities) ? m.modalities : []),
  ].map((x) => str(x).toLowerCase());
  if (modalities.length) return modalities.some((x) => x.includes("image"));

  // OpenRouter also spells it as a "text+image->text" modality string.
  const modality = str(arch.modality) || str(m.modality);
  if (modality) return modality.toLowerCase().includes("image");

  return matchesAny(id, VISION_PATTERNS);
}

/**
 * Is this model free to call?
 *
 * Deliberately conservative. A wrong `vision` guess wastes a request; a wrong
 * `free` guess can bill the user's card, so this only ever reports free on hard
 * evidence: an explicit zero price, an explicit free tier flag, or the `:free`
 * id suffix that OpenRouter guarantees. Absent all three it inherits the
 * provider's own free flag, which is what the curated catalogue already claimed.
 */
function detectFree(m: Raw, id: string, provider: Provider): boolean {
  if (/:free\b/i.test(id)) return true;

  const pricing = obj(m.pricing);
  const prompt = num(pricing.prompt);
  const completion = num(pricing.completion);
  if (prompt !== undefined && completion !== undefined) return prompt === 0 && completion === 0;

  // Pollinations marks its keyless models `tier: "anonymous"`; "seed" and "flower"
  // both require an account.
  const tier = str(m.tier).toLowerCase();
  if (tier) return tier === "anonymous";

  if (typeof m.free === "boolean") return m.free;

  return provider.free === true;
}

/** Context window, under whichever key. */
function detectContext(m: Raw): number | undefined {
  const top = obj(m.top_provider);
  return (
    num(m.context_length) ??
    num(m.context_window) ??
    num(m.max_context_length) ??
    num(top.context_length) ??
    num(obj(m.limits).max_context_tokens)
  );
}

// ---------------------------------------------------------------------------
// Labelling
// ---------------------------------------------------------------------------

/**
 * A human label for a bare model id.
 *
 * Providers that return a `name` get to keep it. Otherwise we tidy the id:
 * strip the `vendor/` prefix and the `:free` suffix, split on separators and
 * title-case, then repair the tokens that title-casing mangles (`gpt` → `GPT`,
 * `vl` → `VL`, `7b` → `7B`).
 */
const ACRONYMS: Record<string, string> = {
  gpt: "GPT", vl: "VL", llm: "LLM", ai: "AI", tts: "TTS", ocr: "OCR",
  vlm: "VLM", moe: "MoE", it: "IT", hf: "HF", nim: "NIM", api: "API",
  r1: "R1", qwq: "QwQ", sd: "SD", xl: "XL", v2: "V2", v3: "V3",
};

export function prettyLabel(id: string, given?: string): string {
  const name = (given || "").trim();
  if (name && name !== id) return name;

  const bare = id.replace(/^[^/]+\//, "").replace(/:free$/i, "");
  return bare
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((tok) => {
      const low = tok.toLowerCase();
      if (ACRONYMS[low]) return ACRONYMS[low];
      if (/^\d+(\.\d+)?[bkm]$/i.test(tok)) return tok.toUpperCase(); // 7b → 7B, 70B, 1.5B
      if (/^\d/.test(tok)) return tok; // version numbers stay as-is
      return tok.charAt(0).toUpperCase() + tok.slice(1);
    })
    .join(" ");
}

/** The badge suffix shown in the picker, built from what we detected. */
function decorate(label: string, caps: { vision: boolean; free: boolean; reasoning: boolean }): string {
  const tags: string[] = [];
  if (caps.vision) tags.push("vision");
  if (caps.reasoning) tags.push("reasoning");
  tags.push(caps.free ? "free" : "paid");
  return `${label} (${tags.join(", ")})`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ClassifiedModel extends ModelDef {
  /** Belongs in the image-generation picker, not the chat picker. */
  imageGen?: boolean;
  /** Exposes a chain of thought worth rendering in the thinking panel. */
  reasoning?: boolean;
}

/**
 * Turn one raw entry from a `/models` response into a `ModelDef`.
 * Returns null for entries that are not chat models at all.
 */
export function classifyModel(raw: unknown, provider: Provider): ClassifiedModel | null {
  const m = obj(raw);
  const id = detectId(m);
  if (!id) return null;

  const haystack = `${id} ${str(m.name)} ${str(m.description)}`;
  const imageGen = matchesAny(id, IMAGE_GEN_PATTERNS);

  // Non-chat endpoints are dropped; image generators are kept but tagged, since
  // the Generate Image picker wants exactly those.
  if (!imageGen && matchesAny(haystack, NON_CHAT_PATTERNS)) return null;

  const vision = imageGen ? false : detectVision(m, id);
  const free = detectFree(m, id, provider);
  const reasoning = !imageGen && matchesAny(haystack, REASONING_PATTERNS);
  const label = prettyLabel(id, str(m.name));

  return {
    id,
    label: imageGen ? `${label} (image gen)` : decorate(label, { vision, free, reasoning }),
    vision,
    free,
    imageGen: imageGen || undefined,
    reasoning: reasoning || undefined,
    context: detectContext(m),
    description: str(m.description) || undefined,
  };
}

/**
 * Pull the model array out of a `/models` body.
 *
 * Covers the four shapes in the wild: OpenAI's `{data: […]}`, Ollama's
 * `{models: […]}`, a bare top-level array (Pollinations, LLM7), and the
 * occasional `{result: […]}`. A body that is an array of plain strings — which
 * some Pollinations endpoints return — is lifted into objects first so the rest
 * of the pipeline sees a uniform shape.
 */
export function extractModelArray(data: unknown): unknown[] {
  const d = obj(data);
  const arr: unknown[] = Array.isArray(data)
    ? data
    : (Array.isArray(d.data) && d.data) ||
      (Array.isArray(d.models) && d.models) ||
      (Array.isArray(d.result) && d.result) ||
      [];
  return arr.map((x) => (typeof x === "string" ? { id: x } : x));
}

/**
 * Merge a freshly fetched list over the hand-curated one.
 *
 * The curated entries are kept and win on `label`, because they carry knowledge
 * no endpoint reports — which model is actually good at maths OCR, which one is
 * rate-limited into uselessness, the ⭐ on the recommended default. Live entries
 * add everything new the provider has started hosting since this app was built,
 * and refresh `vision`/`free`/`context` on the ones we already knew about, which
 * is the part that goes stale.
 */
export function mergeModels(curated: ModelDef[], live: ClassifiedModel[]): ModelDef[] {
  const byId = new Map<string, ModelDef>();
  for (const m of curated) byId.set(m.id, { ...m });

  for (const m of live) {
    const existing = byId.get(m.id);
    if (existing) {
      byId.set(m.id, {
        ...existing,
        vision: m.vision,
        free: m.free,
        context: m.context ?? existing.context,
        // Carried over so a curated entry that turns out to be an image engine
        // still reaches the Generate Image picker rather than the chat one.
        imageGen: m.imageGen ?? existing.imageGen,
      });
    } else {
      byId.set(m.id, m);
    }
  }

  // Curated order first (it is deliberate — best model at the top), then the
  // newcomers alphabetically so a 300-model list stays navigable.
  const curatedIds = new Set(curated.map((m) => m.id));
  const kept = curated.map((m) => byId.get(m.id)!).filter(Boolean);
  const added = [...byId.values()]
    .filter((m) => !curatedIds.has(m.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  return [...kept, ...added];
}
