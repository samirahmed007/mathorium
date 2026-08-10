import type { PersistedState } from "@/types";

// The `mathforge.` prefix on every persisted key survives the v9 rename to Mathorium
// on purpose. These keys are where a user's API keys, providers and chat history live;
// renaming them would not migrate that data, it would orphan it — every existing user
// would open v9 to a factory-fresh app and their keys gone. The prefix is invisible
// (it is a localStorage key, not UI) and the cost of changing it is unbounded, so it
// stays. Anything user-facing that carried the old name — download filenames, the
// service-worker cache, referer headers — was renamed.
export const STORAGE_KEY = "mathforge.state.v4";
export const SCHEMA_VERSION = 24;
// v8.3 deliberately does NOT bump this. Its one persisted addition is
// `ChatMessage.reasoning`, which is optional and absent on every older message — so an
// old conversation reads correctly with no migration, and bumping would only cost users
// the settings reconciliation for nothing.
// v24: v8.2 — the MathType tab is a full standalone editor page rather than a dialog
//      embedded in a page: menu bar, palette ribbons, visual + LaTeX panes, template
//      bar and status bar are the tab itself, with an optional link to a converted
//      expression and its source image. The pop-over editor stays for quick edits from
//      a result card. No new persisted state.
// v23: v8.1 — MathType tab as standalone editor with source image, live agentic
//      workflow trace rendered in the chat panel, palette dropdowns fixed (portalled),
//      split-view rendering fixed, visual editor scrolling/Enter/Space fixed, and
//      Offline/Online switches showing their own state. No new persisted state.
// v22: v8 — Agent Mode (`agentMode`, `agentDepth`): chat replies are planned, then
//      audited and corrected before the user sees them. On by default, because the
//      quality difference on anything non-trivial is what makes a small free model
//      worth using. Also v8: the MathType visual equation editor, local GGUF models
//      loaded from disk, and the rebuilt chat composer — none of which add state.
// v21: v7 — `pix2textRepair`: the offline OCR output goes through a repair pass that
//      corrects delimiters the decoder read as the wrong shape (a tall `(` coming
//      back as `[`), canonicalizes operators and font switches, and flags the
//      delimiters it is not confident enough to rewrite. On by default.
// v20: v7 — the default provider moves from Puter to LLM7. Live in-browser testing
//      (2026-08-04) showed Puter's anonymous session needs interactive sign-in and
//      never settles, so a first reply cost the full 45s timeout plus a rotation,
//      while LLM7's keyless turbo tier answers in about a second. Existing users
//      still pointed at a keyless-unreachable default are moved across once here;
//      anyone who set an API key, or chose something else, is left alone.
// v19: v7 — `autoContinue`: a reply that stops at the max_tokens cap is resumed
//      instead of being handed to the user cut off mid-sentence.
// v18: v7 — Offline/Online master switches in the top bar (`offlineEnabled` /
//      `onlineEnabled`) gate which provider families are listed at all, plus a
//      persisted `sidebarCollapsed`.
// v17: explicit `convertEngine` ("local" | "cloud" | "both") replaces the pair of
//      booleans, which could express a meaningless state (local enabled but not
//      first == cloud only) and offered no way to run local-only.
// v16: v6 — Pix2Text runs on onnxruntime-web directly and actually works, so local
//      math OCR is now on by default; retired local models ("pix2text-quantized",
//      "trocr") are remapped instead of wiping the user's keys and history.
// v15: v6 fix — Pix2Text as default local OCR model, engine indicator in results
// v12: v5 — local OCR engine, enhanced MathML, comprehensive math editor, keyboard shortcuts
// v11: Pollinations correctly marked text-only, DuckDuckGo disabled (CORS-blocked), image-to-image, fullscreen viewer
// v10: fixed Pollinations (text-only, not vision), improved DuckDuckGo CORS, more image gen models
// v9: added LLM7.io, OpenRouter Free vision providers, vision-specific fallback chain
// v8: v4 — multi-provider fallback, DuckDuckGo, WebLLM, HuggingFace, chat history

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return { ...fallback, ...parsed } as T;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // storage full or unavailable — try to clear old keys and retry
    try {
      // Remove old v3 state keys to make room
      ["mathforge.state", "mathforge.state.v1", "mathforge.state.v2", "mathforge.state.v3"].forEach((k) =>
        localStorage.removeItem(k),
      );
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }
}

// Returns true if this is the first run on the current schema version.
// On first run it wipes stale data; afterwards settings persist normally.
export function migrateIfNeeded(): boolean {
  try {
    const vRaw = localStorage.getItem("mathforge.schema");
    const v = vRaw ? Number(vRaw) : 0;
    if (v >= SCHEMA_VERSION) return false;

    // v15..v23 → v24 are settings-only changes. Patch the fields in place so
    // existing users keep their API keys, providers and chat history.
    if (v >= 15 && v <= 23) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const state = JSON.parse(raw);
          const s = state?.settings;
          if (s && typeof s === "object") {
            // Retired ids would fail the narrowed Settings union.
            if (s.localOCRModel === "pix2text-quantized") s.localOCRModel = "pix2text";
            else if (s.localOCRModel === "trocr" || s.localOCRModel == null) s.localOCRModel = "auto";
            // Derive the new three-way mode from whatever the old booleans said.
            // Local-enabled-but-not-first behaved as cloud-only, so it maps there.
            if (s.convertEngine !== "local" && s.convertEngine !== "cloud" && s.convertEngine !== "both") {
              s.convertEngine = v === 15 ? "both" : s.useLocalOCR && s.localOCRFirst ? "both" : "cloud";
            }
            s.useLocalOCR = s.convertEngine !== "cloud";
            s.localOCRFirst = s.convertEngine !== "cloud";
            // v18: derive the master switches from the engine the user already had,
            // so an existing cloud user is not silently cut off from their providers.
            if (typeof s.offlineEnabled !== "boolean") s.offlineEnabled = s.convertEngine !== "cloud";
            if (typeof s.onlineEnabled !== "boolean") s.onlineEnabled = s.convertEngine !== "local";
            if (!s.offlineEnabled && !s.onlineEnabled) s.offlineEnabled = true;
            if (typeof s.sidebarCollapsed !== "boolean") s.sidebarCollapsed = false;
            // v19: on by default — a truncated answer is a bug from the user's side.
            if (typeof s.autoContinue !== "boolean") s.autoContinue = true;
            // v21: on by default. The repair pass only ever rewrites output the raw
            // decoder got demonstrably wrong, so there is no reason to make an
            // existing user opt in to correct brackets.
            if (typeof s.pix2textRepair !== "boolean") s.pix2textRepair = true;
            // v22: Agent Mode on by default for existing users too. It is the
            // headline of v8 and off-by-default would mean nobody meets it.
            if (typeof s.agentMode !== "boolean") s.agentMode = true;
            if (s.agentDepth !== "quick" && s.agentDepth !== "balanced" && s.agentDepth !== "thorough") {
              s.agentDepth = "balanced";
            }
          }
          // v20: move off a default that cannot answer without a key. Only the two
          // ids that earlier versions shipped as defaults are touched, and only when
          // the user never pasted a key for them — an explicit key means they set it
          // up deliberately (and for Puter it means a real signed-in session).
          const stale = state?.activeProviderId;
          if (stale === "puter" || stale === "pollinations") {
            const hasKey = !!state?.providers?.find((p: any) => p?.id === stale)?.apiKey?.trim();
            if (!hasKey) {
              state.activeProviderId = "llm7";
              state.activeModelId = "gpt-oss:20b";
            }
          }
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        }
        localStorage.setItem("mathforge.schema", String(SCHEMA_VERSION));
        return false; // migrated in place, not a fresh start
      } catch {
        /* fall through to the full reset below */
      }
    }

    [
      "mathforge.state",
      "mathforge.state.v1",
      "mathforge.state.v2",
      "mathforge.state.v3",
      "mathforge.providers",
      "mathforge.settings",
    ].forEach((k) => localStorage.removeItem(k));
    localStorage.setItem("mathforge.schema", String(SCHEMA_VERSION));
    return true; // fresh start
  } catch {
    return false;
  }
}

export function loadPersisted(fallback: PersistedState): PersistedState {
  return loadJSON<PersistedState>(STORAGE_KEY, fallback);
}

export function savePersisted(state: PersistedState): void {
  saveJSON(STORAGE_KEY, state);
}

export function clearPersisted(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem("mathforge.schema");
    localStorage.removeItem("mathforge.state");
    localStorage.removeItem("mathforge.state.v1");
    localStorage.removeItem("mathforge.state.v2");
    localStorage.removeItem("mathforge.state.v3");
  } catch {
    /* ignore */
  }
}
