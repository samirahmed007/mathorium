// Core domain types for Mathorium

export type AuthScheme = "none" | "bearer" | "x-api-key";

/**
 * What the user picked, which is not the same as what is on screen: "system"
 * resolves against `prefers-color-scheme` and follows it live. Only "dark" and
 * "light" are ever applied to the document — see `resolveTheme` in the store.
 */
export type ThemeChoice = "dark" | "light" | "system";

export interface ModelDef {
  id: string;
  label?: string;
  vision: boolean;
  free?: boolean;
  note?: string;
  context?: number; // context window in tokens
  description?: string;
  /**
   * Draws pictures rather than answering questions, so it belongs in the Generate
   * Image picker and not the chat one. Set by `classifyModel` from the live model
   * list, and persisted, so an engine a provider added after this app was built
   * appears in Generate Image after one "Fetch live". See `lib/imageGen`.
   */
  imageGen?: boolean;
}

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  chatPath: string; // appended to baseUrl, e.g. /v1/chat/completions or /openai
  modelsPath?: string; // optional endpoint to list available models
  authScheme: AuthScheme;
  apiKey: string;
  apiKeyPlaceholder?: string;
  models: ModelDef[];
  visionDefault?: string;
  textDefault?: string;
  free?: boolean; // works with no key
  builtin?: boolean;
  signupUrl?: string;
  docsUrl?: string;
  description?: string;
  notes?: string; // e.g. CORS warning
  color?: string;
  kind?: "openai" | "puter" | "pollinations" | "duckduckgo" | "webllm" | "gguf" | "custom"; // routing hint
  enableStream?: boolean;
  /**
   * Set when the user hand-edits a builtin provider's model list. It tells
   * `syncBuiltinProviders` to preserve their list instead of replacing it with the
   * current code catalogue on the next load.
   */
  modelsEdited?: boolean;
}

export interface Settings {
  concurrency: number;
  temperature: number;
  maxTokens: number;
  proxyPrefix: string;
  autoCorsProxy: boolean;
  detailLevel: "high" | "low" | "auto";
  autoMathml: boolean;
  theme: ThemeChoice;
  systemPrompt: string;
  chatSystemPrompt: string;
  requestTimeout: number;
  // v4 additions
  autoFallback: boolean; // auto-rotate to next free provider on errors
  verifyLatex: boolean; // post-process & validate LaTeX output
  multiPass: boolean; // run convert twice and pick best result
  streamChat: boolean;
  sendOnEnter: boolean;
  maxChatHistory: number; // number of past chats to keep
  showTokenCount: boolean;
  // v5/v6 additions
  /**
   * Which OCR engine(s) the Convert tab may use:
   *   "local" — Pix2Text only; never calls a cloud provider (fully offline)
   *   "cloud" — cloud vision model only; Pix2Text is not run
   *   "both"  — Pix2Text first, cloud vision as fallback if it fails
   */
  convertEngine: "local" | "cloud" | "both";
  useLocalOCR: boolean; // legacy mirror of convertEngine != "cloud" (kept for older persisted state)
  localOCRModel: "auto" | "pix2text" | "texteller";
  recognitionQuality: "fast" | "balanced" | "high-accuracy"; // which local OCR engine to use
  localOCRFirst: boolean; // legacy mirror of convertEngine != "cloud"
  enhancedMathml: boolean; // use multi-engine LaTeX→MathML (temml + latex2mathml)
  // v7 additions
  /**
   * Master switches for which provider families the whole app may use.
   *
   * `offlineEnabled` covers engines that run in the browser with no network and no
   * key (Pix2Text, WebLLM); `onlineEnabled` covers every hosted provider. They are
   * independent so "offline only" (the default) and "both" are equally expressible.
   * At least one is always kept on — see setSettings in the store.
   */
  offlineEnabled: boolean;
  onlineEnabled: boolean;
  /** Sidebar hidden state, persisted so the layout choice survives a reload. */
  sidebarCollapsed: boolean;
  /**
   * Keep asking for the rest when a reply stops at the `max_tokens` cap, instead
   * of leaving the user with an answer cut off mid-sentence. Costs extra requests
   * on long answers, so it can be switched off.
   */
  autoContinue: boolean;
  /**
   * Run the Pix2Text repair pass over offline OCR output (see lib/pix2textRepair).
   * The raw decoder emits structurally-correct but textually denormalized LaTeX —
   * doubled braces, `\operatorname{l o g}`, TeX 2.09 font switches, and delimiters
   * of the wrong shape. Repair is display-preserving and idempotent, so it can also
   * be applied to an already-converted result from the result card.
   */
  pix2textRepair: boolean;
  // v8 additions
  /**
   * Agent Mode: answer chat messages with a plan → solve → audit → revise workflow
   * instead of a single pass (see lib/agent). On by default, because the quality
   * gain on anything non-trivial is large and it is the difference between a small
   * model being usable and not. Costs extra round trips, so it can be switched off.
   */
  agentMode: boolean;
  /** How many extra passes Agent Mode spends. See lib/agent's AgentDepth. */
  agentDepth: "quick" | "balanced" | "thorough";
}

export type JobStatus = "pending" | "queued" | "running" | "done" | "error";

export type ConversionMode = "expression" | "mixed" | "lines";

export interface ConvertResult {
  id: string;
  fileName: string;
  dataUrl: string;
  status: JobStatus;
  raw?: string;
  expressions: string[];
  originalExpressions?: string[];
  mathml: string[];
  error?: string;
  createdAt: number;
  mode: ConversionMode;
  provider?: string;
  model?: string;
  attempts?: number;
  /**
   * What the Pix2Text repair pass did to this result, and what it could only flag.
   * Present only for offline OCR results that went through repair.
   */
  repairs?: { rule: string; label: string; count: number }[];
}

export interface ChatAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  kind: "image" | "text" | "zip" | "binary";
  dataUrl?: string; // images
  text?: string; // text file content (or extracted from zip)
  note?: string;
  files?: { name: string; text?: string; note?: string }[]; // zip listing
}

export interface GenImage {
  url: string;
  prompt: string;
  provider: string;
  w: number;
  h: number;
  model: string;
  seed: number;
  isImageToImage?: boolean;
  referenceImage?: string;
}

/** Which pass of the Agent Mode workflow a trace step belongs to. */
export type AgentStepPhase = "plan" | "solve" | "tools" | "verify" | "revise";

/**
 * One pass of the Agent Mode workflow, as the user sees it.
 *
 * Persisted with the message rather than kept in component state, so reopening a
 * conversation still shows how an answer was reached. `text` is the full streamed
 * output of that pass — the plan, the audit's findings, the revision — because a
 * trace that only lists phase names is not evidence that anything happened.
 */
export interface AgentStep {
  id: string;
  phase: AgentStepPhase;
  label: string;
  text: string;
  status: "running" | "done" | "failed";
  /** Short result shown on the collapsed row, e.g. "2 issues". */
  summary?: string;
  startedAt: number;
  endedAt?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  images?: string[];
  attachments?: ChatAttachment[];
  genImage?: GenImage;
  createdAt: number;
  pending?: boolean;
  error?: string;
  edited?: boolean;
  provider?: string;
  model?: string;
  tokens?: number;
  /** Agent Mode trace, when the reply was produced with it on. */
  agentSteps?: AgentStep[];
  /**
   * The model's own chain of thought, kept separate from the answer.
   *
   * Reasoning models deliver this either in `delta.reasoning`/`reasoning_content`
   * (Pollinations, OpenRouter, DeepSeek-style) or inline in the content between
   * `<think>` tags (MiniMax, Qwen, DeepSeek-R1 and most open reasoning models). Both
   * are collected here so the answer bubble holds only the answer, and the thinking
   * can be shown in its own collapsible panel.
   */
  reasoning?: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  provider?: string;
  model?: string;
}

export interface PersistedState {
  providers: Provider[];
  settings: Settings;
  activeProviderId: string;
  activeModelId: string;
  conversations: Conversation[];
  activeConversationId: string | null;
  theme: ThemeChoice;
}

export interface ToastMsg {
  id: string;
  title: string;
  description?: string;
  tone?: "default" | "success" | "error" | "info" | "warning";
  duration?: number;
}
