import type { Provider, Settings } from "@/types";

// Editable default system prompt — instructs the vision model to emit clean LaTeX.
// v4: heavily refined with explicit examples, edge cases, and verification hints.
export const DEFAULT_SYSTEM_PROMPT = `You are the Mathorium OCR Engine, an elite specialist in transcribing mathematics from images into flawless LaTeX.

# PRIMARY DIRECTIVE
Transcribe EVERY mathematical expression visible in the image, reading top-to-bottom, left-to-right, exactly as written. Output ONLY LaTeX wrapped in <math>…</math> tags. No prose, no commentary, no introductions, no explanations.

# OUTPUT FORMAT (STRICT)
- Wrap EACH distinct expression with <math> and </math> tags, on its own single line.
- One expression per <math> block. Never put a line break inside a single expression — flatten it onto one line.
- If the image has NO math at all, output exactly: <math></math>
- Do not output anything outside <math>...</math> tags.

# MULTI-LINE / CHAINED EQUATIONS (CRITICAL)
If an equation or derivation spans several lines AND is logically ONE statement — e.g. a chain of relations like A < B < C = D, step-by-step equalities a = b = c, or a proof line that wraps — you MUST output it as ONE single <math> block using:
  \\begin{aligned} ... \\end{aligned}   (use & before each relational operator and \\\\ between rows)
  or  \\begin{gathered} ... \\end{gathered}
NEVER split a connected multi-line equation into multiple <math> blocks.

# CANONICAL LaTeX COMMANDS
- Fractions: \\frac{num}{den}
- Roots: \\sqrt[n]{x}
- Sums/Products/Integrals: \\sum_{i=1}^{n}, \\prod_{i=1}^{n}, \\int_{a}^{b}, \\oint, \\iint, \\iiint
- Limits: \\lim_{x \\to 0}
- Binomial: \\binom{n}{k}
- Determinant: \\det(A)
- Multi-row: \\begin{matrix}, \\begin{pmatrix}, \\begin{bmatrix}, \\begin{vmatrix}, \\begin{Bmatrix}, \\begin{cases}, \\begin{aligned}, \\begin{gathered}, \\begin{array}{c}
- Inside matrix/cases/aligned: use & for column separator, \\\\ for row separator
- Blackboard: \\mathbb{R}, \\mathbb{N}, \\mathbb{Z}, \\mathbb{C}, \\mathbb{Q}, \\mathbb{H}
- Calligraphic: \\mathcal{L}, \\mathcal{F}
- Fraktur: \\mathfrak{g}
- Vectors/Accents: \\vec{v}, \\hat{x}, \\bar{z}, \\tilde{u}, \\dot{x}, \\ddot{x}, \\widehat{AB}, \\overrightarrow{AB}, \\overline{AB}, \\underline{AB}
- Text inside math: \\text{words} (NEVER raw prose in math)
- Greek: \\alpha \\beta \\gamma \\delta \\epsilon \\varepsilon \\zeta \\eta \\theta \\vartheta \\iota \\kappa \\lambda \\mu \\nu \\xi \\pi \\varpi \\rho \\varrho \\sigma \\varsigma \\tau \\upsilon \\phi \\varphi \\chi \\psi \\omega
- Greek capitals: \\Gamma \\Delta \\Theta \\Lambda \\Xi \\Pi \\Sigma \\Upsilon \\Phi \\Psi \\Omega
- Operators: \\pm \\mp \\times \\div \\cdot \\leq \\geq \\neq \\approx \\equiv \\sim \\simeq \\cong \\propto \\infty \\partial \\nabla \\forall \\exists \\in \\notin \\subset \\subseteq \\supset \\supseteq \\cup \\cap \\emptyset \\to \\rightarrow \\leftarrow \\leftrightarrow \\Rightarrow \\Leftarrow \\Leftrightarrow \\mapsto \\vdash \\dashv \\models
- Arrows: \\uparrow \\downarrow \\updownarrow \\Uparrow \\Downarrow \\Updownarrow \\rightrightarrows \\leadsto \\hookrightarrow \\rightleftharpoons
- Functions: \\sin \\cos \\tan \\cot \\sec \\csc \\sinh \\cosh \\tanh \\arcsin \\arccos \\arctan \\log \\ln \\exp \\min \\max \\sup \\inf \\limsup \\liminf \\arg \\det \\dim \\deg \\gcd \\Pr \\hom \\ker

# EDGE CASES & TIPS
- Handwriting: read carefully, preserve the writer's intent. If a glyph is ambiguous, pick the most mathematically sensible interpretation.
- Subscripts/superscripts with multiple characters MUST be braced: x_{ij}, e^{i\\pi}, a_{n+1}.
- Derivatives: \\frac{d}{dx}, \\frac{d^2 y}{dx^2}, \\frac{\\partial f}{\\partial x}, \\nabla \\cdot \\vec{F}, \\nabla \\times \\vec{F}.
- Integrals with differentials: \\int_{0}^{1} x^2 \\, dx (use \\, before dx).
- Modular arithmetic: a \\equiv b \\pmod{n}.
- Set builders: \\{ x \\in \\mathbb{R} \\mid x > 0 \\}.
- Function definitions: f(x) = \\begin{cases} x^2 & x \\geq 0 \\\\ -x & x < 0 \\end{cases}.
- Limits with side: \\lim_{x \\to 0^+}, \\lim_{x \\to a^-}.
- Continued fractions: a_0 + \\cfrac{1}{a_1 + \\cfrac{1}{a_2 + \\cdots}}.
- Tensors with indices: T^{\\mu\\nu}_{\\rho\\sigma}, R_{\\mu\\nu} - \\tfrac{1}{2} R g_{\\mu\\nu}.
- Chemical equations (if present): use \\text{ for elements}, ^ for superscripts, _ for subscripts.
- Equation numbers, page artifacts, watermarks and handwriting guides: IGNORE.
- Recognize handwriting, printed text, typed PDFs, photos, screenshots and whiteboards alike.

# ACCURACY CHECKLIST (self-verify before emitting)
1. Every variable has correct case (a vs A, x vs X).
2. Every multi-char subscript/superscript is braced.
3. Every matrix/piecewise/aligned uses correct & and \\\\ separators.
4. Every word inside math is wrapped with \\text{...}.
5. No raw markdown, no code fences, no $$ delimiters — only the bare LaTeX inside <math>...</math>.

COMPLEXITY: handle integrals, derivatives, limits, infinite series, matrices, determinants, tensors, piecewise functions, summations with multi-line limits, chemical equations, logic/set notation, statistics, tensors — accurately and without compromise.`;

export const DEFAULT_CHAT_SYSTEM_PROMPT = `You are the Mathorium Assistant, a world-class mathematician, engineer, and LaTeX/typesetting expert.

# CORE RULES
- You can perform ANY task: solve, explain, simplify, differentiate, integrate, prove, transcribe, write code, analyze files, and reason step by step.
- ALWAYS typeset math with LaTeX: inline as $...$ and display as $$...$$. Use \\( ... \\) or \\[ ... \\] sparingly.
- When you produce code, wrap it in fenced code blocks with the language: \`\`\`python ... \`\`\`.
- Use Markdown for structure: headings (##, ###), lists, **bold**, *italic*, tables when useful.
- Be precise, concise, and verify final results. Show intermediate steps when solving.
- When the user attaches files (including extracted ZIP contents), read and use their contents precisely.

# MATH CONVENTIONS
- For step-by-step solutions, use display math $$...$$ for each step on its own line.
- Use \\begin{aligned}...\\end{aligned} for chained equations.
- Use \\begin{cases}...\\end{cases} for piecewise functions.
- Define variables before using them.
- For final answers, use \\boxed{...} when appropriate.
- Use \\mathbb{R}, \\mathbb{N}, \\mathbb{Z}, \\mathbb{C} for number sets.

# CODE CONVENTIONS
- Add type annotations where the language supports them.
- Include docstrings/comments for non-trivial functions.
- Prefer standard library functions over reinventing them.
- Provide runnable examples when useful.

# TONE
Professional, encouraging, and clear. Adapt depth to the user's apparent level — go deeper for advanced queries, simpler for beginners. Never condescending.`;

export const DEFAULT_SETTINGS: Settings = {
  concurrency: 2,
  temperature: 0,
  maxTokens: 4096,
  proxyPrefix: "",
  autoCorsProxy: true,
  detailLevel: "high",
  autoMathml: true,
  theme: "dark",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  chatSystemPrompt: DEFAULT_CHAT_SYSTEM_PROMPT,
  requestTimeout: 90,
  // v4
  autoFallback: true,
  verifyLatex: true,
  multiPass: false,
  streamChat: true,
  sendOnEnter: true,
  maxChatHistory: 30,
  showTokenCount: true,
  // v7 — local math OCR is the default engine. The Pix2Text model files are
  // bundled, so it needs no key, no network and no account, and it beats every
  // free cloud vision model on cropped formulas. This is "local" rather than
  // "both" to stay consistent with `onlineEnabled: false` below — a first run is
  // fully offline, and the Convert picker shows Pix2Text as the selected engine.
  // Flipping Online on in the top bar is what opens up the cloud fallback.
  convertEngine: "local",
  useLocalOCR: true, // legacy mirror, kept in sync by the store
  localOCRModel: "auto", // "auto" migrates to the pinned Pix2Text MFR recipe
  recognitionQuality: "balanced", // engine adapters map this to their supported decoding controls
  autoConvertAfterImport: true, // wait for a full import, then queue offline recognition automatically
  localOCRFirst: true, // legacy mirror, kept in sync by the store
  enhancedMathml: true, // use multi-engine LaTeX→MathML
  // v7 — both master switches start on. Offline covers Convert (the bundled
  // Pix2Text model needs no key or network, and `convertEngine: "local"` above
  // selects it), while Online is what makes Chat usable on a first run: the
  // offline-only chat options are WebLLM (a multi-GB WebGPU download) and Ollama
  // (needs a local install), so starting with Online off would leave the Chat
  // tab with nothing that answers out of the box. Either switch can be turned
  // off from the top bar.
  offlineEnabled: true,
  onlineEnabled: true,
  sidebarCollapsed: false,
  // A long derivation routinely exceeds any single completion's token cap, and a
  // proof that stops mid-step is worse than useless — so continue by default.
  autoContinue: true,
  // The Pix2Text decoder's output is structurally right but textually denormalized,
  // and its one substantive error — a delimiter of the wrong shape — is invisible in
  // the text. Repair is display-preserving and idempotent, so leaving it on can only
  // improve the result; it stays switchable for anyone who wants the untouched decode.
  pix2textRepair: true,
  // v8: Agent Mode is on by default. The extra passes are what let an ordinary
  // free model answer like a much larger one; anyone who wants raw single-pass
  // speed can turn it off in Settings → Chat.
  agentMode: true,
  agentDepth: "balanced",
};

/**
 * Whether a provider runs without reaching the public internet.
 *
 * WebLLM executes in the browser via WebGPU, local GGUF executes in the browser via
 * WebAssembly, and Ollama talks to localhost, so all three keep working with Online
 * switched off. Everything else is a hosted API. The Offline/Online master switches
 * and the store's engine coercion both read this, so they cannot drift apart.
 */
export function isOfflineProvider(id: string): boolean {
  return id === "webllm" || id === "ollama" || id === "gguf";
}

// All presets speak the OpenAI Chat Completions wire format, so a single generic
// client can drive every one of them – except Puter, Pollinations-free, DuckDuckGo
// and WebLLM which have their own custom clients.
export const DEFAULT_PROVIDERS: Provider[] = [
  // ── Puter.js – truly keyless, browser-native, 500+ models, vision supported.
  {
    id: "puter",
    name: "Puter · Free, No Key ⭐",
    description:
      "100% free, no signup, no API key, browser-native. 500+ models via Puter.js – GPT-4o, Claude 3.5/4, Gemini 2, Grok, DeepSeek, Llama. Vision supported. Auto-falls back to other free providers on rate-limit.",
    baseUrl: "puter://ai",
    chatPath: "/chat",
    modelsPath: "",
    authScheme: "none",
    apiKey: "puter",
    free: true,
    builtin: true,
    color: "#f97316",
    kind: "puter",
    enableStream: true,
    docsUrl: "https://developer.puter.com/tutorials/free-llm-api/",
    signupUrl: "https://puter.com",
    notes: "Keyless & serverless. Loads https://js.puter.com/v2/ in your browser. If a model 404s or shows 'insufficient balance', Mathorium auto-rotates to Pollinations/DuckDuckGo/WebLLM.",
    visionDefault: "gpt-4o",
    textDefault: "gpt-4o-mini",
    models: [
      { id: "gpt-4o", label: "GPT-4o (vision) ✅", vision: true, free: true },
      { id: "gpt-4o-mini", label: "GPT-4o mini (vision) ✅", vision: true, free: true },
      { id: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet (vision) ✅", vision: true, free: true },
      { id: "claude-3-7-sonnet", label: "Claude 3.7 Sonnet (vision)", vision: true, free: true },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash (vision) ✅", vision: true, free: true },
      { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro (vision)", vision: true, free: true },
      { id: "openai/gpt-4o", label: "openai/gpt-4o", vision: true, free: true },
      { id: "openai/gpt-4o-mini", label: "openai/gpt-4o-mini", vision: true, free: true },
      { id: "openai/gpt-4.1", label: "GPT-4.1", vision: true, free: true },
      { id: "openai/gpt-4.1-mini", label: "GPT-4.1 mini", vision: true, free: true },
      { id: "claude-sonnet-4-6", label: "claude-sonnet-4-6", vision: true, free: true },
      { id: "claude-opus-4-8", label: "claude-opus-4-8", vision: true, free: true },
      { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", vision: true, free: true },
      { id: "gemini-2.5-flash", label: "gemini-2.5-flash", vision: true, free: true },
      { id: "x-ai/grok-4", label: "Grok 4", vision: true, free: true },
      { id: "grok-4", label: "grok-4", vision: true, free: true },
      { id: "deepseek/deepseek-chat", label: "DeepSeek V3", vision: false, free: true },
      { id: "deepseek-reasoner", label: "DeepSeek R1", vision: false, free: true },
      { id: "perceptron/perceptron-mk1", label: "Perceptron Mk1 (vision/OCR) ⭐", vision: true, free: true },
      { id: "x-ai/grok-2-vision-1212", label: "Grok 2 Vision", vision: true, free: true },
      { id: "moonshotai/moonshot-v1-128k-vision-preview", label: "Kimi Vision", vision: true, free: true },
      { id: "qwen/qwen-vl-max", label: "Qwen VL Max", vision: true, free: true },
      { id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick", vision: true, free: true },
      { id: "meta-llama/llama-4-scout", label: "Llama 4 Scout", vision: true, free: true },
    ],
  },
  // ── Pollinations Free text endpoint (no key needed)
  // RESEARCH FINDING (2026-08-03): the anonymous POST tier at text.pollinations.ai
  // is Cloudflare Turnstile-gated. From a Node origin, cache HITs return 200 and
  // cache MISSes return 402 "Payment Required".
  //
  // RE-VERIFIED FROM A REAL BROWSER (2026-08-04) — worse than the 402 above, and
  // this is the case that matters because Mathorium only ever runs in a browser:
  // every endpoint returns 403 {"error":"Missing Turnstile token"} regardless of
  // the prompt, including the model list:
  //     POST /openai   403 Missing Turnstile token
  //     GET  /<prompt> 403 Missing Turnstile token
  //     GET  /models   403 Missing Turnstile token
  // A cache hit cannot rescue it either, since the 403 is issued before the cache
  // is consulted. So text chat here is NOT reachable in-browser at all: the models
  // below are marked free:false so the keyless rotation skips them (see
  // `keylessFallbackModel`), and the provider sits last in FREE_FALLBACK_CHAIN
  // instead of second. It stays registered because the entry is still useful with
  // a real pk_/sk_ key, and because image GENERATION is a separate keyless host.
  {
    id: "pollinations",
    name: "Pollinations · Free Image Gen (text needs key)",
    description:
      "Free anonymous tier for image generation (image.pollinations.ai) — keyless, seed varies output, img2img supported. Text chat (text.pollinations.ai) is Turnstile-gated and returns 403 \"Missing Turnstile token\" for every in-browser request, so it needs a pk_/sk_ key to work from Mathorium. Verified live 2026-08-04. For free no-key text chat use LLM7.io; for free no-key math OCR use the bundled local Pix2Text engine.",
    baseUrl: "https://text.pollinations.ai",
    chatPath: "/openai",
    modelsPath: "https://text.pollinations.ai/models",
    authScheme: "none",
    apiKey: "",
    apiKeyPlaceholder: "sk_… / pk_… – leave blank for free anonymous tier",
    free: true,
    builtin: true,
    color: "#22c55e",
    kind: "pollinations",
    enableStream: true,
    docsUrl: "https://github.com/pollinations/pollinations/blob/main/APIDOCS.md",
    signupUrl: "https://enter.pollinations.ai",
    notes: "Text chat needs a key: from a browser every request returns 403 \"Missing Turnstile token\" (verified live 2026-08-04), so keyless calls auto-rotate to LLM7/WebLLM. Paste a pk_/sk_ key from enter.pollinations.ai to use the models below. NO image OCR either way (gpt-oss-20b has no vision). Image GENERATION on image.pollinations.ai still works fully keyless.",
    visionDefault: "openai",
    textDefault: "openai",
    models: [
      // free:false — not a price statement but a reachability one: keyless these
      // 403, so the free rotation must not offer them as a no-key option. With a
      // key pasted in they become selectable again (`isKeylessReachable` and the
      // picker both treat `provider.apiKey` as unlocking the full list).
      { id: "openai", label: "GPT-OSS 20B (text) — needs key", vision: false, free: false },
      { id: "openai-fast", label: "GPT-OSS 20B Fast (text) — needs key", vision: false, free: false },
    ],
  },
  // ── LLM7.io — OpenAI-compatible. REQUIRES A FREE KEY, and the free key only
  // reaches the "turbo" tier.
  // VERIFIED LIVE (2026-08-03) against https://api.llm7.io/v1/models and
  // /v1/chat/completions:
  //   • The 4 "turbo" ids (usage_based_only=false) answer KEYLESS with 200 — no
  //     key, no account. All 4 verified live: gpt-oss:20b, minimax-m2.7,
  //     codestral-latest, meta-Llama-3.1-8B-Instruct-Turbo each returned the
  //     correct quadratic formula. A free key is only needed for the pro tier.
  //   • Pro ids (usage_based_only=true, 33 of them) return 401 "Missing API key."
  //     keyless, and are usage-billed even with one, so they are marked
  //     free:false and the free-provider rotation never picks one.
  //   • Every vision-capable id is pro tier, so keyless LLM7 is TEXT ONLY. For
  //     zero-key math OCR use the bundled local Pix2Text engine or Puter.
  //   • gpt-5.4-mini (previously listed) no longer exists on the endpoint.
  //   • access-control-allow-origin: * on both the POST and the OPTIONS
  //     preflight, so the browser can call it directly — no CORS proxy needed.
  //   • stream:true returns a real text/event-stream (59 SSE data lines on a
  //     count-to-5 prompt), so streaming chat works.
  //   • gpt-oss:20b and minimax-m2.7 are reasoning models: they spend tokens on
  //     a scratchpad first, so a small max_tokens finishes with reason "length"
  //     and an empty `content`. At the 4096 default they answer normally, and
  //     llm.ts falls back to the reasoning field if content is ever empty.
  {
    id: "llm7",
    name: "LLM7.io · Free, No Key (text)",
    description:
      "OpenAI-compatible endpoint at api.llm7.io/v1. The 4 'turbo' models — GPT-OSS 20B, MiniMax M2.7 (reasoning), Codestral, Llama 3.1 8B — answer with no key and no account, send CORS headers, and support streaming. All text-only. Vision and the GPT-5.x/Claude-5 models are 'pro' tier: they need a key and bill per token. Verified live 2026-08-04.",
    baseUrl: "https://api.llm7.io/v1",
    chatPath: "/chat/completions",
    modelsPath: "https://api.llm7.io/v1/models",
    authScheme: "bearer",
    apiKey: "",
    apiKeyPlaceholder: "optional — only needed for the paid 'pro' models",
    free: true,
    builtin: true,
    color: "#06b6d4",
    kind: "openai",
    enableStream: true,
    docsUrl: "https://llm7.io",
    signupUrl: "https://dash.llm7.io/#/api-keys",
    notes:
      "The 4 'turbo' models work with NO key at all (verified live 2026-08-04) and the endpoint sends access-control-allow-origin: *, so the browser calls it directly — no CORS proxy needed. They are text-only; the vision and GPT-5.x/Claude-5 ids are 'pro' tier, need a key and are usage-billed. For zero-key math OCR use the bundled local Pix2Text engine or Puter.",
    visionDefault: "claude-opus-5",
    textDefault: "gpt-oss:20b",
    models: [
      // ── "turbo" tier: usage_based_only = false. Reachable with no key at all,
      // so they lead the list and supply textDefault.
      { id: "gpt-oss:20b", label: "GPT-OSS 20B (text, no key) ⭐", vision: false, free: true, note: "turbo tier — no key needed, live-tested" },
      { id: "minimax-m2.7", label: "MiniMax M2.7 (reasoning, no key) ⭐", vision: false, free: true, note: "turbo tier — no key needed, live-tested" },
      { id: "codestral-latest", label: "Codestral (code, no key)", vision: false, free: true, note: "turbo tier — no key needed, live-tested" },
      { id: "meta-Llama-3.1-8B-Instruct-Turbo", label: "Llama 3.1 8B Turbo (text, no key)", vision: false, free: true, note: "turbo tier — no key needed, live-tested" },
      // ── "pro" tier: usage_based_only = true, so these bill per token and a
      // free key is expected to be refused. Listed because they are the only
      // vision-capable ids on the endpoint.
      { id: "claude-opus-5", label: "Claude Opus 5 (vision, paid tier)", vision: true, free: false, note: "pro tier — usage-billed" },
      { id: "claude-opus-4-8", label: "Claude Opus 4.8 (vision, paid tier)", vision: true, free: false, note: "pro tier — usage-billed" },
      { id: "gpt-5.5", label: "GPT-5.5 (vision, paid tier)", vision: true, free: false, note: "pro tier — usage-billed" },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna (vision, paid tier)", vision: true, free: false, note: "pro tier — usage-billed" },
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol (vision, paid tier)", vision: true, free: false, note: "pro tier — usage-billed" },
      { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite (vision, paid tier)", vision: true, free: false, note: "pro tier — usage-billed" },
      { id: "gemini-omni-flash", label: "Gemini Omni Flash (vision, paid tier)", vision: true, free: false, note: "pro tier — usage-billed" },
      { id: "gpt-5.4", label: "GPT-5.4 (reasoning, paid tier)", vision: false, free: false, note: "pro tier — usage-billed" },
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra (text, paid tier)", vision: false, free: false, note: "pro tier — usage-billed" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5 (reasoning, paid tier)", vision: false, free: false, note: "pro tier — usage-billed" },
      { id: "claude-fable-5", label: "Claude Fable 5 (reasoning, paid tier)", vision: false, free: false, note: "pro tier — usage-billed" },
      { id: "gemini-3.5-flash-low", label: "Gemini 3.5 Flash Low (reasoning, paid tier)", vision: false, free: false, note: "pro tier — usage-billed" },
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash (reasoning, paid tier)", vision: false, free: false, note: "pro tier — usage-billed" },
      { id: "kimi-k3", label: "Kimi K3 (text, paid tier)", vision: false, free: false, note: "pro tier — usage-billed" },
      { id: "kimi-k2.7-code", label: "Kimi K2.7 Code (code, paid tier)", vision: false, free: false, note: "pro tier — usage-billed" },
      { id: "grok-4.5", label: "Grok 4.5 (text, paid tier)", vision: false, free: false, note: "pro tier — usage-billed" },
      { id: "XiaomiMiMo/MiMo-V2.5-Pro", label: "MiMo V2.5 Pro (text, paid tier)", vision: false, free: false, note: "pro tier — usage-billed" },
      { id: "mistral-Small-24B-Instruct-2501", label: "Mistral Small 24B (text, paid tier)", vision: false, free: false, note: "pro tier — usage-billed" },
      { id: "Inkling", label: "Inkling (reasoning, paid tier)", vision: false, free: false, note: "pro tier — usage-billed" },
    ],
  },
  // ── OpenRouter Free — many free vision models with one key
  {
    id: "openrouter-free",
    name: "OpenRouter Free · Vision 🆕",
    description:
      "Hundreds of free models via OpenRouter — many with vision. Includes Llama 4 Scout/Maverick, Qwen2.5 VL, Gemini 2.0 Flash, Gemma 3. One free key from openrouter.ai gives access to all.",
    baseUrl: "https://openrouter.ai/api/v1",
    chatPath: "/chat/completions",
    authScheme: "bearer",
    apiKey: "",
    apiKeyPlaceholder: "sk-or-… (free signup at openrouter.ai)",
    free: true,
    builtin: true,
    color: "#8b5cf6",
    kind: "openai",
    enableStream: true,
    signupUrl: "https://openrouter.ai/keys",
    docsUrl: "https://openrouter.ai/docs",
    notes: "Free signup, then use free models (suffixed :free). CORS-friendly. Best free vision models: Llama 4 Scout, Qwen2.5 VL 72B, Gemini 2.0 Flash.",
    visionDefault: "meta-llama/llama-4-scout:free",
    textDefault: "meta-llama/llama-3.3-70b-instruct:free",
    models: [
      { id: "meta-llama/llama-4-scout:free", label: "Llama 4 Scout (free, vision) ⭐", vision: true, free: true },
      { id: "meta-llama/llama-4-maverick:free", label: "Llama 4 Maverick (free, vision)", vision: true, free: true },
      { id: "qwen/qwen2.5-vl-72b-instruct:free", label: "Qwen2.5 VL 72B (free, vision)", vision: true, free: true },
      { id: "qwen/qwen2-vl-72b-instruct:free", label: "Qwen2 VL 72B (free, vision)", vision: true, free: true },
      { id: "google/gemini-2.0-flash-exp:free", label: "Gemini 2.0 Flash (free, vision)", vision: true, free: true },
      { id: "google/gemma-3-27b-it:free", label: "Gemma 3 27B (free, vision)", vision: true, free: true },
      { id: "google/gemma-3-12b-it:free", label: "Gemma 3 12B (free, vision)", vision: true, free: true },
      { id: "google/gemma-3-4b-it:free", label: "Gemma 3 4B (free, vision)", vision: true, free: true },
      { id: "meta-llama/llama-3.2-90b-vision-instruct:free", label: "Llama 3.2 90B Vision (free)", vision: true, free: true },
      { id: "meta-llama/llama-3.2-11b-vision-instruct:free", label: "Llama 3.2 11B Vision (free)", vision: true, free: true },
      { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (free, text)", vision: false, free: true },
      { id: "deepseek/deepseek-r1:free", label: "DeepSeek R1 (free, text)", vision: false, free: true },
    ],
  },
  // ── DuckDuckGo AI Chat — DISABLED in browser (CORS-blocked)
  // RESEARCH FINDING (June 2026): DuckDuckGo's duckchat API does NOT send CORS
  // headers (access-control-allow-origin), so browsers block ALL direct requests.
  // The API also changed: it now returns x-vqd-hash-1 (not x-vqd-4), and the hash
  // is computed from browser-fingerprinting JS that can't run in a fetch context.
  // CORS proxies can't forward the custom headers reliably.
  // Conclusion: DuckDuckGo AI Chat CANNOT work from a browser. It's kept in the
  // list for documentation but will always fail. Use Puter or LLM7.io instead.
  {
    id: "duckduckgo",
    name: "DuckDuckGo AI · (browser-blocked)",
    description:
      "DuckDuckGo AI Chat (GPT-4o mini, Claude Haiku, Llama 3.1 70B). DISABLED — DuckDuckGo does not send CORS headers, so browsers block all requests. Cannot work from a web app. Use Puter or LLM7.io instead.",
    baseUrl: "https://duckduckgo.com/duckchat/v1",
    chatPath: "/chat",
    modelsPath: "",
    authScheme: "none",
    apiKey: "duckduckgo",
    free: true,
    builtin: true,
    color: "#de5833",
    kind: "duckduckgo",
    enableStream: true,
    docsUrl: "https://duckduckgo.com/duckchat",
    notes: "⛔ CANNOT work in browser — DuckDuckGo blocks CORS. Kept for documentation only. Test Connection will always fail. Use Puter or LLM7.io for free text chat.",
    visionDefault: "gpt-4o-mini",
    textDefault: "gpt-4o-mini",
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o mini ⭐", vision: false, free: true },
      { id: "claude-3-haiku-20240307", label: "Claude 3 Haiku", vision: false, free: true },
      { id: "meta-llama/Llama-3.1-70B-Instruct-Turbo", label: "Llama 3.1 70B", vision: false, free: true },
      { id: "mistralai/Mixtral-8x7B-Instruct-v0.1", label: "Mixtral 8x7B", vision: false, free: true },
      { id: "o3-mini", label: "o3-mini", vision: false, free: true },
    ],
  },
  // ── HuggingFace Inference — free, no key for many models (rate-limited)
  {
    id: "huggingface",
    name: "HuggingFace · Free Tier 🆕",
    description:
      "Free inference on hundreds of open models (Qwen, Llama, Mistral, Phi, Gemma). Some models work without a key (rate-limited); a free HF token unlocks higher limits. Vision models available.",
    baseUrl: "https://api-inference.huggingface.co/models",
    chatPath: "/chat/completions",
    modelsPath: "",
    authScheme: "bearer",
    apiKey: "",
    apiKeyPlaceholder: "hf_… (leave blank for free anonymous, slow tier)",
    free: true,
    builtin: true,
    color: "#ffbd2e",
    kind: "openai",
    enableStream: true,
    docsUrl: "https://huggingface.co/docs/api-inference",
    signupUrl: "https://huggingface.co/settings/tokens",
    notes: "Free tier with no key (rate-limited). Get a free HF token for higher limits. Router endpoint auto-routes to best available model.",
    visionDefault: "meta-llama/Llama-3.2-11B-Vision-Instruct",
    textDefault: "meta-llama/Meta-Llama-3-8B-Instruct",
    models: [
      { id: "meta-llama/Meta-Llama-3-8B-Instruct", label: "Llama 3 8B ⭐", vision: false, free: true },
      { id: "meta-llama/Llama-3.2-11B-Vision-Instruct", label: "Llama 3.2 11B Vision", vision: true, free: true },
      { id: "meta-llama/Llama-3.2-3B-Instruct", label: "Llama 3.2 3B (fast)", vision: false, free: true },
      { id: "Qwen/Qwen2.5-7B-Instruct", label: "Qwen 2.5 7B", vision: false, free: true },
      { id: "Qwen/Qwen2.5-72B-Instruct", label: "Qwen 2.5 72B", vision: false, free: true },
      { id: "mistralai/Mistral-7B-Instruct-v0.3", label: "Mistral 7B v0.3", vision: false, free: true },
      { id: "mistralai/Mixtral-8x7B-Instruct-v0.1", label: "Mixtral 8x7B", vision: false, free: true },
      { id: "microsoft/Phi-3.5-mini-instruct", label: "Phi 3.5 mini", vision: false, free: true },
      { id: "google/gemma-2-9b-it", label: "Gemma 2 9B", vision: false, free: true },
      { id: "google/gemma-2-2b-it", label: "Gemma 2 2B (fast)", vision: false, free: true },
    ],
  },
  // ── WebLLM — fully in-browser, no network, no key, runs on WebGPU
  {
    id: "webllm",
    name: "WebLLM · In-Browser (Offline) 🆕",
    description:
      "Runs Llama 3.2, Phi 3.5, Qwen 2.5, Mistral 7B directly in your browser via WebGPU. 100% private — no network calls after model download. No API key, no signup, works offline. ~2-4 GB model download on first use.",
    baseUrl: "webllm://local",
    chatPath: "/chat/completions",
    modelsPath: "",
    authScheme: "none",
    apiKey: "webllm",
    free: true,
    builtin: true,
    color: "#8b5cf6",
    kind: "webllm",
    enableStream: true,
    docsUrl: "https://github.com/mlc-ai/web-llm",
    notes: "Fully private — runs on your GPU. Requires WebGPU (Chrome 113+, Edge 113+, Safari 18+). First use downloads ~2-4 GB. Vision NOT supported (text only).",
    visionDefault: "Llama-3.2-3B-Instruct-q4f32_1-MLC",
    textDefault: "Llama-3.2-3B-Instruct-q4f32_1-MLC",
    models: [
      { id: "Llama-3.2-3B-Instruct-q4f32_1-MLC", label: "Llama 3.2 3B (fast) ⭐", vision: false, free: true },
      { id: "Llama-3.2-1B-Instruct-q4f32_1-MLC", label: "Llama 3.2 1B (ultra-fast)", vision: false, free: true },
      { id: "Llama-3.1-8B-Instruct-q4f32_1-MLC", label: "Llama 3.1 8B", vision: false, free: true },
      { id: "Qwen2.5-7B-Instruct-q4f32_1-MLC", label: "Qwen 2.5 7B", vision: false, free: true },
      { id: "Qwen2.5-1.5B-Instruct-q4f32_1-MLC", label: "Qwen 2.5 1.5B (fast)", vision: false, free: true },
      { id: "Phi-3.5-mini-instruct-q4f32_1-MLC", label: "Phi 3.5 mini", vision: false, free: true },
      { id: "mistralai_Mistral-7B-Instruct-v0.3-q4f32_1-MLC", label: "Mistral 7B v0.3", vision: false, free: true },
      { id: "gemma-2-2b-it-q4f32_1-MLC", label: "Gemma 2 2B", vision: false, free: true },
      { id: "Hermes-3-Llama-3.2-3B-q4f32_1-MLC", label: "Hermes 3 Llama 3.2 3B", vision: false, free: true },
      { id: "SmolLM2-1.7B-Instruct-q4f32_1-MLC", label: "SmolLM2 1.7B (tiny)", vision: false, free: true },
    ],
  },
  // ── Local GGUF — llama.cpp in WebAssembly, model supplied by the user from disk
  {
    id: "gguf",
    name: "Local GGUF · Your Own Model 🆕",
    description:
      "Run any .gguf model straight off your hard drive — Qwen3-VL, Llama, Mistral, Phi, Gemma, whatever you have. llama.cpp compiled to WebAssembly, so no GPU is required and nothing is uploaded. Pick the file once; vision works too if you add the model's mmproj file.",
    baseUrl: "gguf://local",
    chatPath: "",
    modelsPath: "",
    authScheme: "none",
    apiKey: "gguf",
    free: true,
    builtin: true,
    color: "#22c55e",
    kind: "gguf",
    enableStream: true,
    docsUrl: "https://github.com/ngxson/wllama",
    notes:
      "Load a .gguf file in Settings → Local GGUF before selecting this provider. Runs on the CPU via WebAssembly — no WebGPU needed, but expect slower generation than a hosted model. Keep the file under ~3 GB: WebAssembly can only address 4 GB. Vision needs the matching mmproj-*.gguf selected alongside the model.",
    // Both defaults are the sentinel below; the real identity of the model is
    // whatever file the user loaded, which is not knowable at build time.
    visionDefault: "local-gguf",
    textDefault: "local-gguf",
    models: [
      { id: "local-gguf", label: "Loaded local model", vision: true, free: true },
    ],
  },
  // ── Google Gemini (key required)
  {
    id: "google",
    name: "Google Gemini",
    description: "OpenAI-compatible Gemini endpoint. Generous free tier, excellent vision + reasoning.",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    chatPath: "/chat/completions",
    authScheme: "bearer",
    apiKey: "",
    apiKeyPlaceholder: "AIza… (Google AI Studio key)",
    builtin: true,
    color: "#4285f4",
    kind: "openai",
    enableStream: true,
    signupUrl: "https://aistudio.google.com/app/apikey",
    docsUrl: "https://ai.google.dev/gemini-api/docs/openai",
    notes: "Free tier available. Get a key from Google AI Studio.",
    visionDefault: "gemini-3.1-flash-lite",
    textDefault: "gemini-3.1-flash-lite",
    models: [
      { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite ⭐", vision: true },
      { id: "gemini-3.1-flash", label: "Gemini 3.1 Flash", vision: true },
      { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro", vision: true },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", vision: true },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", vision: true },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", vision: true },
      { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro", vision: true },
    ],
  },
  // ── Groq (key required, free tier)
  {
    id: "groq",
    name: "Groq",
    description: "Ultra-fast inference with a generous free tier. Llama 4 models support vision.",
    baseUrl: "https://api.groq.com/openai/v1",
    chatPath: "/chat/completions",
    authScheme: "bearer",
    apiKey: "",
    apiKeyPlaceholder: "gsk_…",
    builtin: true,
    color: "#f55036",
    kind: "openai",
    enableStream: true,
    signupUrl: "https://console.groq.com/keys",
    docsUrl: "https://console.groq.com/docs",
    notes: "Free tier, CORS-friendly. Llama 4 Scout/Maverick are multimodal.",
    visionDefault: "meta-llama/llama-4-scout-17b-16e-instruct",
    textDefault: "llama-3.3-70b-versatile",
    models: [
      { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout (vision)", vision: true },
      { id: "meta-llama/llama-4-maverick-17b-128e-instruct", label: "Llama 4 Maverick (vision)", vision: true },
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", vision: false },
      { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant", vision: false },
    ],
  },
  // ── OpenRouter (key required)
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "Gateway to hundreds of models incl. many free vision models. One key, many providers.",
    baseUrl: "https://openrouter.ai/api/v1",
    chatPath: "/chat/completions",
    authScheme: "bearer",
    apiKey: "",
    apiKeyPlaceholder: "sk-or-…",
    builtin: true,
    color: "#8b5cf6",
    kind: "openai",
    enableStream: true,
    signupUrl: "https://openrouter.ai/keys",
    docsUrl: "https://openrouter.ai/docs",
    notes: "CORS-friendly. 'openrouter/free' auto-routes to the best free model. Models suffixed ':free' cost nothing.",
    visionDefault: "openrouter/free",
    textDefault: "openrouter/free",
    models: [
      { id: "openrouter/free", label: "Auto · free (best available) ⭐", vision: false, free: true },
      { id: "openrouter/auto", label: "Auto (any model)", vision: false, free: false },
      { id: "google/gemini-2.0-flash-exp:free", label: "Gemini 2.0 Flash (free, vision)", vision: true, free: true },
      { id: "meta-llama/llama-4-maverick:free", label: "Llama 4 Maverick (free, vision)", vision: true, free: true },
      { id: "meta-llama/llama-4-scout:free", label: "Llama 4 Scout (free, vision)", vision: true, free: true },
      { id: "qwen/qwen2.5-vl-72b-instruct:free", label: "Qwen2.5 VL 72B (free, vision)", vision: true, free: true },
      { id: "google/gemma-3-27b-it:free", label: "Gemma 3 27B (free, vision)", vision: true, free: true },
      { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (free)", vision: false, free: true },
      { id: "deepseek/deepseek-r1:free", label: "DeepSeek R1 (free)", vision: false, free: true },
    ],
  },
  // ── OpenAI (paid)
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT-4o / o-series. Industry-leading vision. Note: direct browser calls may need a CORS proxy.",
    baseUrl: "https://api.openai.com/v1",
    chatPath: "/chat/completions",
    authScheme: "bearer",
    apiKey: "",
    apiKeyPlaceholder: "sk-…",
    builtin: true,
    color: "#10a37f",
    kind: "openai",
    enableStream: true,
    signupUrl: "https://platform.openai.com/api-keys",
    docsUrl: "https://platform.openai.com/docs",
    notes: "Add a CORS proxy prefix in Settings if calls are blocked by the browser.",
    visionDefault: "gpt-4o",
    textDefault: "gpt-4o-mini",
    models: [
      { id: "gpt-4o", label: "GPT-4o (vision)", vision: true },
      { id: "gpt-4o-mini", label: "GPT-4o mini (vision)", vision: true },
      { id: "gpt-4.1", label: "GPT-4.1 (vision)", vision: true },
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini (vision)", vision: true },
      { id: "o4-mini", label: "o4-mini (vision)", vision: true },
    ],
  },
  // ── Mistral (free tier)
  {
    id: "mistral",
    name: "Mistral / la Plateforme",
    description: "Pixtral models offer strong document & math vision. Free tier available.",
    baseUrl: "https://api.mistral.ai/v1",
    chatPath: "/chat/completions",
    authScheme: "bearer",
    apiKey: "",
    apiKeyPlaceholder: "…",
    builtin: true,
    color: "#fa520f",
    kind: "openai",
    enableStream: true,
    signupUrl: "https://console.mistral.ai/api-keys",
    docsUrl: "https://docs.mistral.ai/",
    notes: "Pixtral models are multimodal.",
    visionDefault: "pixtral-12b-2409",
    textDefault: "mistral-small-latest",
    models: [
      { id: "pixtral-large-2411", label: "Pixtral Large (vision)", vision: true },
      { id: "pixtral-12b-2409", label: "Pixtral 12B (vision)", vision: true },
      { id: "mistral-large-latest", label: "Mistral Large", vision: false },
      { id: "mistral-small-latest", label: "Mistral Small", vision: false },
    ],
  },
  // ── Together AI (free credit on signup)
  {
    id: "together",
    name: "Together AI",
    description: "Open-source models with vision variants. Free credit on signup.",
    baseUrl: "https://api.together.xyz/v1",
    chatPath: "/chat/completions",
    authScheme: "bearer",
    apiKey: "",
    apiKeyPlaceholder: "…",
    builtin: true,
    color: "#0f6fff",
    kind: "openai",
    enableStream: true,
    signupUrl: "https://api.together.ai/settings/api-keys",
    docsUrl: "https://docs.together.ai/",
    notes: "Vision models available via Llama-Vision / Qwen-VL.",
    visionDefault: "meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo",
    textDefault: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    models: [
      { id: "meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo", label: "Llama 3.2 90B Vision", vision: true },
      { id: "Qwen/Qwen2-VL-72B-Instruct", label: "Qwen2 VL 72B", vision: true },
      { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", label: "Llama 3.3 70B", vision: false },
    ],
  },
  // ── DeepSeek (paid, text only)
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "Strong reasoning (DeepSeek-R1). Primarily text; cheap and capable.",
    baseUrl: "https://api.deepseek.com/v1",
    chatPath: "/chat/completions",
    authScheme: "bearer",
    apiKey: "",
    apiKeyPlaceholder: "sk-…",
    builtin: true,
    color: "#4d6bfe",
    kind: "openai",
    enableStream: true,
    signupUrl: "https://platform.deepseek.com/api_keys",
    docsUrl: "https://api-docs.deepseek.com/",
    notes: "Use for chat / reasoning. Image OCR not supported.",
    visionDefault: "deepseek-chat",
    textDefault: "deepseek-chat",
    models: [
      { id: "deepseek-chat", label: "DeepSeek V3", vision: false },
      { id: "deepseek-reasoner", label: "DeepSeek R1 (reasoning)", vision: false },
    ],
  },
  // ── Cerebras (free tier, text only)
  {
    id: "cerebras",
    name: "Cerebras",
    description: "Blazing-fast text inference (text only). Great for the Chat tab.",
    baseUrl: "https://api.cerebras.ai/v1",
    chatPath: "/chat/completions",
    authScheme: "bearer",
    apiKey: "",
    apiKeyPlaceholder: "csk-…",
    builtin: true,
    color: "#e23744",
    kind: "openai",
    enableStream: true,
    signupUrl: "https://cloud.cerebras.ai/",
    docsUrl: "https://inference-docs.cerebras.ai/",
    notes: "Text only — use for conversation, not image OCR.",
    visionDefault: "llama3.1-8b",
    textDefault: "llama3.1-8b",
    models: [
      { id: "llama3.1-8b", label: "Llama 3.1 8B", vision: false },
      { id: "llama-3.3-70b", label: "Llama 3.3 70B", vision: false },
      { id: "qwen-3-32b", label: "Qwen 3 32B", vision: false },
    ],
  },
  // ── Ollama (local)
  {
    id: "ollama",
    name: "Ollama · Local & Cloud (Free)",
    description: "Run models offline on your machine, or use Ollama-hosted cloud models (no key). 100% free & private.",
    baseUrl: "http://localhost:11434/v1",
    chatPath: "/chat/completions",
    modelsPath: "http://localhost:11434/api/tags",
    authScheme: "none",
    apiKey: "ollama",
    builtin: true,
    color: "#22c55e",
    kind: "openai",
    enableStream: true,
    signupUrl: "https://ollama.com/download",
    docsUrl: "https://ollama.com/library",
    notes: "LOCAL needs OLLAMA_ORIGINS=\"*\" ollama serve running, then ollama pull <model>. Cloud models (gemma3:cloud, qwen3.5:cloud, kimi-k2:cloud…) need Ollama Cloud enabled in your Ollama config. Localhost can't use a CORS proxy.",
    visionDefault: "gemma3:cloud",
    textDefault: "gemma3:cloud",
    models: [
      { id: "gemma3:cloud", label: "Gemma 3 Cloud (vision) ⭐", vision: true, free: true },
      { id: "gemma3:31b-cloud", label: "Gemma 3 31B Cloud", vision: true, free: true },
      { id: "qwen3.5:cloud", label: "Qwen 3.5 Cloud", vision: true, free: true },
      { id: "qwen3.5:397b-cloud", label: "Qwen 3.5 397B Cloud", vision: true, free: true },
      { id: "minimax-m3:cloud", label: "MiniMax M3 Cloud", vision: true, free: true },
      { id: "kimi-k2.7-code:cloud", label: "Kimi K2.7 Code Cloud", vision: true, free: true },
      { id: "kimi-k2.5:cloud", label: "Kimi K2.5 Cloud", vision: true, free: true },
      { id: "kimi-k2.6:cloud", label: "Kimi K2.6 Cloud", vision: true, free: true },
      { id: "llama3.2-vision", label: "Llama 3.2 Vision (local)", vision: true, free: true },
      { id: "minicpm-v", label: "MiniCPM-V (local)", vision: true, free: true },
      { id: "llava", label: "LLaVA (local)", vision: true, free: true },
      { id: "llama3.1", label: "Llama 3.1 (local)", vision: false, free: true },
      { id: "qwen2.5", label: "Qwen 2.5 (local)", vision: false, free: true },
    ],
  },
  // ── NVIDIA NIM (free tier)
  {
    id: "nvidia",
    name: "NVIDIA NIM (Free)",
    description: "NVIDIA build.nvidia.com NIM endpoints — frontier open models (Llama, Qwen, DeepSeek, Mistral) with a free prototyping tier. Note: requires CORS proxy in browser.",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    chatPath: "/chat/completions",
    modelsPath: "https://integrate.api.nvidia.com/v1/models",
    authScheme: "bearer",
    apiKey: "",
    apiKeyPlaceholder: "nvapi-… (build.nvidia.com key)",
    builtin: true,
    color: "#76b900",
    kind: "openai",
    enableStream: true,
    signupUrl: "https://build.nvidia.com",
    docsUrl: "https://docs.api.nvidia.com/nim/reference",
    notes: "Free prototyping tier, no card. NVIDIA blocks direct browser (CORS) calls — Mathorium's Auto CORS-proxy (Settings) bypasses this automatically. Best capability: Llama 3.x Nemotron & Qwen.",
    visionDefault: "meta/llama-3.2-90b-vision-instruct",
    textDefault: "meta/llama-3.3-70b-instruct",
    models: [
      { id: "meta/llama-3.3-70b-instruct", label: "Llama 3.3 70B ⭐", vision: false, free: true },
      { id: "meta/llama-3.2-90b-vision-instruct", label: "Llama 3.2 90B Vision", vision: true, free: true },
      { id: "meta/llama-3.1-405b-instruct", label: "Llama 3.1 405B", vision: false, free: true },
      { id: "meta/llama-3.1-nemotron-70b-instruct", label: "Llama 3.1 Nemotron 70B", vision: false, free: true },
      { id: "nvidia/llama-3.1-nemotron-ultra-253b-v1", label: "Nemotron Ultra 253B", vision: false, free: true },
      { id: "qwen/qwen2.5-coder-32b-instruct", label: "Qwen 2.5 Coder 32B", vision: false, free: true },
      { id: "qwen/qwen2.5-vl-32b-instruct", label: "Qwen 2.5 VL 32B (vision)", vision: true, free: true },
      { id: "deepseek-ai/deepseek-r1", label: "DeepSeek R1", vision: false, free: true },
      { id: "deepseek-ai/deepseek-v3.1", label: "DeepSeek V3.1", vision: false, free: true },
      { id: "mistralai/mistral-nemo-12b-instruct", label: "Mistral Nemo 12B", vision: false, free: true },
    ],
  },
];

// Ordered list of free no-key providers to try as fallback when the active one fails.
// Used by the smart fallback chain in llm.ts for TEXT chat.
// DuckDuckGo is EXCLUDED — it cannot work from a browser (CORS-blocked), and as
// of 2026-08-04 its /chat endpoint answers 418 ERR_CHALLENGE even server-side.
//
// Order reflects live in-browser measurement (2026-08-04), strongest first:
//   • llm7 — the only cloud provider that answers keyless with real content from a
//     browser origin. 3 of 4 turbo ids returned the correct LaTeX in 0.6–2.6s and
//     SSE streaming works, so it leads.
//   • puter — keyless in principle and the only free VISION option, but its
//     anonymous session currently needs interactive sign-in and hangs rather than
//     rejecting (isSignedIn:false, getUser→Unauthorized, chat pending at 60s).
//     puterClient now caps each call and raises PuterTimeoutError so this costs
//     one timeout instead of forever, but it must not be tried first for text when
//     llm7 answers in a second.
//   • webllm — always works offline, but only after a multi-GB WebGPU download, so
//     it is the last resort rather than an early hop.
//   • pollinations — moved to the end: keyless in-browser text is 403 Turnstile on
//     every endpoint, so it can only contribute once the user pastes a key.
export const FREE_FALLBACK_CHAIN = [
  "llm7",
  "puter",
  "webllm",
  "pollinations",
];

/**
 * Whether a provider can be reached with no user-supplied API key.
 *
 * `authScheme === "none"` covers most of them, but LLM7 is a special case: it is
 * declared "bearer" because its paid pro tier needs a key, yet its 4 turbo model
 * ids answer keyless with 200 and send `access-control-allow-origin: *`
 * (verified live 2026-08-04). Without this the fallback chain would skip LLM7 for
 * lack of a key and lose a working free provider.
 */
export function isKeylessReachable(p: Provider): boolean {
  if (p.authScheme === "none") return true;
  if (p.apiKey) return true;
  return p.id === "llm7";
}

/**
 * The model to use when falling back to `p` without a key. For LLM7 this must be
 * a turbo id — its `textDefault` already is one, but `visionDefault` points at a
 * pro model that would 401, so vision fallback has to be resolved from the
 * free-flagged models rather than the declared default.
 */
export function keylessFallbackModel(p: Provider, needsVision: boolean): string {
  return keylessSiblingModels(p, needsVision)[0] || p.textDefault || p.models[0]?.id || "";
}

/**
 * Every model on `p` the keyless tier can serve, best first.
 *
 * A failure is usually the *model*, not the host: an id is overloaded, or briefly
 * 400s, while its siblings answer normally. Rotating straight to another provider
 * when that happens is worse than useless if the next provider in the chain cannot
 * serve keyless requests at all — with LLM7 selected, one flaky id sent the request
 * to Pollinations, whose anonymous text tier answers every browser call with 403
 * "Missing Turnstile token", so a working provider was abandoned for a broken one.
 * Trying the siblings first keeps the user on the provider they picked.
 *
 * The declared default leads, since that is the id the provider itself recommends.
 */
export function keylessSiblingModels(p: Provider, needsVision: boolean): string[] {
  const usable = p.models
    .filter((m) => (p.apiKey || m.free !== false) && (!needsVision || m.vision))
    .map((m) => m.id);
  const declared = needsVision ? p.visionDefault : p.textDefault;
  return declared && usable.includes(declared)
    ? [declared, ...usable.filter((id) => id !== declared)]
    : usable;
}

// Vision-capable free providers only — used for image OCR fallback.
// Pollinations is EXCLUDED (anonymous tier is text-only, and as of 2026-08-04 an
//   image payload returns 402 outright).
// DuckDuckGo is EXCLUDED (CORS-blocked + text-only).
// WebLLM is EXCLUDED (text-only, in-browser).
//
// Puter is the only KEYLESS cloud vision provider, so it stays first here even
// though its anonymous session is currently unreliable (it hangs pending sign-in;
// see FREE_FALLBACK_CHAIN and puterClient's callWithTimeout). LLM7's vision ids are
// all pro tier (keyless image payloads return 400 "does not support vision input"
// on the turbo ids, 401 on the pro ones), so it only helps here once the user
// supplies a key. With neither key nor Puter session there is no keyless cloud OCR
// left, which is precisely why the bundled local Pix2Text engine is the default
// math OCR path: it is the only option that is genuinely zero-key, zero-cost,
// unlimited and offline. Verified live 2026-08-04.
export const FREE_VISION_FALLBACK_CHAIN = [
  "puter",
  "llm7",
];

export function findProvider(providers: Provider[], id: string): Provider | undefined {
  return providers.find((p) => p.id === id);
}

/** Ids of builtin providers the user removed on purpose — do not resurrect them. */
export const REMOVED_BUILTINS_KEY = "mathforge.removedBuiltins";

function loadRemovedBuiltins(): Set<string> {
  try {
    const raw = localStorage.getItem(REMOVED_BUILTINS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function rememberRemovedBuiltin(id: string): void {
  try {
    const set = loadRemovedBuiltins();
    set.add(id);
    localStorage.setItem(REMOVED_BUILTINS_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

/**
 * Refresh builtin provider definitions from code, keeping user-owned fields.
 *
 * The persisted state stores the whole `providers` array, and `loadJSON` merges only
 * one level deep — so a returning user's saved array *replaced* the code registry
 * wholesale and their builtin providers stayed frozen at whatever shape they had on
 * first run. That is why newly added models (LLM7's 4 keyless turbo ids) were
 * genuinely "not listed" for existing users while being present in the source: they
 * were reading a snapshot taken before those ids existed. Bumping the schema would
 * only fix it by wiping their keys and chat history.
 *
 * So: for every builtin, the code definition wins for catalogue fields (models,
 * name, description, urls, routing) and the stored copy wins for the fields the
 * user owns (`apiKey`, and `models` for a builtin they edited themselves — tracked
 * via `modelsEdited`). Custom providers are passed through untouched, order is
 * preserved with new builtins appended, and builtins the user deliberately removed
 * stay removed.
 */
export function syncBuiltinProviders(stored: Provider[]): Provider[] {
  if (!Array.isArray(stored) || stored.length === 0) return DEFAULT_PROVIDERS;
  const removed = loadRemovedBuiltins();
  const byId = new Map(DEFAULT_PROVIDERS.map((p) => [p.id, p]));
  const seen = new Set<string>();

  const merged: Provider[] = [];
  for (const old of stored) {
    if (!old?.id) continue;
    const def = byId.get(old.id);
    if (!def) {
      merged.push(old); // custom provider — the user's own, leave it alone
      continue;
    }
    seen.add(old.id);
    merged.push({
      ...def,
      apiKey: old.apiKey || "",
      // A user who curated a builtin's model list keeps it; everyone else gets the
      // current catalogue, which is the whole point of this sync.
      ...(old.modelsEdited ? { models: old.models, modelsEdited: true } : {}),
    });
  }
  for (const def of DEFAULT_PROVIDERS) {
    if (!seen.has(def.id) && !removed.has(def.id)) merged.push(def);
  }
  return merged;
}

export function blankProvider(): Provider {
  return {
    id: "custom_" + Math.random().toString(36).slice(2, 8),
    name: "New Provider",
    baseUrl: "https://",
    chatPath: "/v1/chat/completions",
    authScheme: "bearer",
    apiKey: "",
    apiKeyPlaceholder: "sk-…",
    models: [{ id: "gpt-4o-mini", label: "Model", vision: true }],
    visionDefault: "gpt-4o-mini",
    textDefault: "gpt-4o-mini",
    builtin: false,
    color: "#64748b",
    kind: "custom",
    enableStream: true,
    description: "Custom OpenAI-compatible provider.",
  };
}
