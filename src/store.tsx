import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Conversation, PersistedState, Provider, Settings, ChatMessage, ThemeChoice, ToastMsg } from "@/types";
import { DEFAULT_PROVIDERS, DEFAULT_SETTINGS, isOfflineProvider, keylessFallbackModel, syncBuiltinProviders, rememberRemovedBuiltin, REMOVED_BUILTINS_KEY } from "@/lib/providers";
import { savePersisted, loadPersisted, migrateIfNeeded } from "@/lib/storage";

interface StoreValue {
  providers: Provider[];
  settings: Settings;
  activeProviderId: string;
  activeModelId: string;
  activeProvider: Provider;
  activeModel: { id: string; vision: boolean; label?: string };
  isVision: boolean;
  setActiveProvider: (id: string) => void;
  setActiveModel: (id: string) => void;
  updateProvider: (id: string, patch: Partial<Provider>) => void;
  addProvider: (p: Provider) => void;
  removeProvider: (id: string) => void;
  duplicateProvider: (id: string) => void;
  resetProviders: () => void;
  updateSettings: (patch: Partial<Settings>, providerIdOverride?: string) => void;

  // Conversations
  conversations: Conversation[];
  activeConversationId: string | null;
  activeConversation: Conversation | null;
  newConversation: () => string;
  selectConversation: (id: string | null) => void;
  updateConversation: (id: string, patch: Partial<Conversation>) => void;
  deleteConversation: (id: string) => void;
  setConversationMessages: (id: string, messages: ChatMessage[]) => void;
  renameConversation: (id: string, title: string) => void;

  // Toasts
  toasts: ToastMsg[];
  pushToast: (t: Omit<ToastMsg, "id">) => void;
  dismissToast: (id: string) => void;

  // Theme
  /** What the user chose — may be "system". */
  theme: ThemeChoice;
  /** What is actually on screen right now. Never "system". */
  resolvedTheme: "dark" | "light";
  setTheme: (t: ThemeChoice) => void;
  /** Cycles dark → light → system, so one control reaches all three. */
  toggleTheme: () => void;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Collapse a choice to the theme that should actually be painted. */
function resolveTheme(choice: ThemeChoice): "dark" | "light" {
  if (choice !== "system") return choice;
  // Any environment without matchMedia (SSR, very old browsers) gets the app's
  // designed-for default rather than a guess.
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

const INITIAL: PersistedState = {
  providers: DEFAULT_PROVIDERS,
  settings: DEFAULT_SETTINGS,
  // LLM7 rather than Puter: its turbo tier is the only cloud provider measured
  // answering keyless from a browser (0.6–2.6s, verified live 2026-08-04), while
  // Puter's anonymous session needs interactive sign-in and burns its 45s timeout
  // before rotating — a first-run user would wait ~75s for their first reply.
  // Puter stays in FREE_VISION_FALLBACK_CHAIN, where it is still the only keyless
  // cloud vision option, and remains one click away in the picker.
  activeProviderId: "llm7",
  activeModelId: "gpt-oss:20b",
  conversations: [],
  activeConversationId: null,
  theme: "dark",
};

const Ctx = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersistedState>(() => {
    const fresh = migrateIfNeeded();
    const loaded = loadPersisted(INITIAL);
    if (fresh) return INITIAL;
    // Builtin definitions live in code, but the whole providers array is persisted,
    // so a returning user would keep a frozen snapshot of the catalogue and never
    // see models added in later versions. Re-sync it on every load, keeping keys.
    loaded.providers = syncBuiltinProviders(loaded.providers);
    // safety: never let a keyless Pollinations survive as the default — every
    // in-browser request to it returns 403 "Missing Turnstile token", so the tab
    // would be dead on arrival. Puter deliberately is NOT coerced here: it is the
    // only keyless cloud vision option, a user may have picked it on purpose, and
    // a failing call now times out and rotates instead of hanging.
    if (loaded.activeProviderId === "pollinations" && !loaded.providers.find((p) => p.id === "pollinations")?.apiKey) {
      return { ...loaded, activeProviderId: INITIAL.activeProviderId, activeModelId: INITIAL.activeModelId };
    }
    // Merge v4 settings defaults with loaded settings
    return {
      ...INITIAL,
      ...loaded,
      settings: { ...DEFAULT_SETTINGS, ...loaded.settings },
      conversations: loaded.conversations || [],
    };
  });
  const { providers, settings, activeProviderId, activeModelId, conversations, activeConversationId, theme } = state;

  // Mirrors what is painted, so components can branch on the *effective* theme
  // without each one re-reading matchMedia. Initialised eagerly rather than in
  // the effect so the very first render already knows, avoiding a dark flash on
  // a light-preference machine.
  const [resolvedTheme, setResolvedTheme] = useState<"dark" | "light">(() => resolveTheme(state.theme));

  // Persist on state changes
  useEffect(() => {
    savePersisted(state);
  }, [state]);

  // Apply theme to document.
  //
  // Only the *resolved* theme reaches the DOM: `.dark` / `.light` are mutually
  // exclusive and "system" never appears as a class, so CSS never has to know
  // the choice existed. `data-theme` keeps the raw choice for anything that
  // wants to show which mode is selected.
  //
  // The `theme-switching` class suppresses transitions for one frame. Without
  // it, the 200ms colour transition in index.css fires on every surface at once
  // and the swap reads as a smear rather than a switch.
  useEffect(() => {
    const root = document.documentElement;
    const apply = (resolved: "dark" | "light") => {
      root.classList.add("theme-switching");
      root.classList.toggle("dark", resolved === "dark");
      root.classList.toggle("light", resolved === "light");
      root.setAttribute("data-theme", theme);
      root.setAttribute("data-resolved-theme", resolved);
      // Keep the browser's own UI (form controls, scrollbars) in step.
      root.style.colorScheme = resolved;
      const t = window.setTimeout(() => root.classList.remove("theme-switching"), 60);
      return () => window.clearTimeout(t);
    };

    let cleanup = apply(resolveTheme(theme));
    setResolvedTheme(resolveTheme(theme));

    // Only "system" needs to keep listening: the other two are absolute.
    if (theme !== "system" || !window.matchMedia) return cleanup;

    const mq = window.matchMedia(DARK_QUERY);
    const onChange = () => {
      const next = resolveTheme("system");
      cleanup();
      cleanup = apply(next);
      setResolvedTheme(next);
    };
    // addEventListener is unsupported on Safari < 14, which still has the
    // deprecated addListener; both are wired so the OS toggle works either way.
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);

    return () => {
      cleanup();
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, [theme]);

  // Toasts state (not persisted)
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  const activeProvider = useMemo(
    () => providers.find((p) => p.id === activeProviderId) || providers[0],
    [providers, activeProviderId],
  );

  const activeModel = useMemo(() => {
    const m = activeProvider.models.find((mm) => mm.id === activeModelId);
    return (
      m || {
        id: activeModelId,
        vision: false,
        label: activeModelId,
      }
    );
  }, [activeProvider, activeModelId]);

  const setActiveProvider = useCallback(
    (id: string) => {
      const p = providers.find((pp) => pp.id === id);
      // Without a key, prefer a model that can actually answer over one that can
      // see: a keyless user picking LLM7 would otherwise land on its paid
      // `visionDefault` and get 401 "Missing API key." on their first message.
      // With a key, the provider's declared vision default is the better guess
      // because it works on both tabs.
      const modelId =
        (p && !p.apiKey?.trim() ? keylessFallbackModel(p, false) : "") ||
        p?.visionDefault ||
        p?.models.find((mm) => mm.vision)?.id ||
        p?.models[0]?.id ||
        "";
      setState((s) => ({ ...s, activeProviderId: id, activeModelId: modelId }));
    },
    [providers],
  );

  const setActiveModel = useCallback((id: string) => {
    setState((s) => ({ ...s, activeModelId: id }));
  }, []);

  // Heal stale state: if the stored model id isn't valid for the active provider
  useEffect(() => {
    const exists = activeProvider.models.some((m) => m.id === activeModelId);
    if (!exists) {
      // Prefer something reachable over something vision-capable. This runs on
      // every load, so reaching for `visionDefault` first would hand a keyless
      // user a paid model — LLM7's vision ids are all pro tier and 401 — even
      // though they are on the Chat tab where vision is irrelevant.
      const fallback =
        keylessFallbackModel(activeProvider, false) ||
        activeProvider.textDefault ||
        activeProvider.visionDefault ||
        activeProvider.models.find((m) => m.vision)?.id ||
        activeProvider.models[0]?.id;
      if (fallback) setActiveModel(fallback);
    }
  }, [activeProvider, activeModelId, setActiveModel]);

  const updateProvider = useCallback((id: string, patch: Partial<Provider>) => {
    setState((s) => ({
      ...s,
      providers: s.providers.map((p) =>
        p.id === id
          ? {
              ...p,
              ...patch,
              // A hand-edited model list must survive the builtin re-sync on the
              // next load, which would otherwise restore the code catalogue.
              ...(patch.models && p.builtin ? { modelsEdited: true } : {}),
            }
          : p,
      ),
    }));
  }, []);

  const addProvider = useCallback((p: Provider) => {
    setState((s) => ({ ...s, providers: [...s.providers, p] }));
  }, []);

  const removeProvider = useCallback((id: string) => {
    setState((s) => {
      if (s.providers.length <= 1) return s;
      // Record the removal so the builtin re-sync doesn't add it straight back.
      if (s.providers.find((p) => p.id === id)?.builtin) rememberRemovedBuiltin(id);
      const providers = s.providers.filter((p) => p.id !== id);
      const activeProviderId =
        s.activeProviderId === id ? providers[0].id : s.activeProviderId;
      const p = providers.find((pp) => pp.id === activeProviderId);
      // Same reachability-first rule as setActiveProvider: don't strand a keyless
      // user on a paid model just because the provider declares it for vision.
      const activeModelId =
        (p && !p.apiKey?.trim() ? keylessFallbackModel(p, false) : "") ||
        p?.visionDefault ||
        p?.models[0]?.id ||
        "";
      return { ...s, providers, activeProviderId, activeModelId };
    });
  }, []);

  const duplicateProvider = useCallback((id: string) => {
    setState((s) => {
      const src = s.providers.find((p) => p.id === id);
      if (!src) return s;
      const copy: Provider = {
        ...src,
        id: "custom_" + Math.random().toString(36).slice(2, 8),
        name: src.name + " (copy)",
        builtin: false,
        models: src.models.map((m) => ({ ...m })),
      };
      return { ...s, providers: [...s.providers, copy] };
    });
  }, []);

  const resetProviders = useCallback(() => {
    // Forget deliberate builtin removals too, otherwise "reset to defaults" would
    // silently keep withholding providers the user deleted long ago.
    try {
      localStorage.removeItem(REMOVED_BUILTINS_KEY);
    } catch {
      /* ignore */
    }
    setState((s) => ({
      ...s,
      providers: DEFAULT_PROVIDERS,
      settings: DEFAULT_SETTINGS,
      activeProviderId: INITIAL.activeProviderId,
      activeModelId: INITIAL.activeModelId,
    }));
  }, []);

  /**
   * `providerIdOverride` covers the caller that switches provider and engine in
   * the same click: `setActiveProvider` has not been committed yet, so reading
   * `s.activeProviderId` here would still see the previous provider and coerce
   * the engine based on stale state.
   */
  const updateSettings = useCallback((patch: Partial<Settings>, providerIdOverride?: string) => {
    setState((s) => {
      const next = { ...s.settings, ...patch };
      // `convertEngine` is the single source of truth; keep the legacy booleans in
      // sync so any older persisted state or read path stays consistent with it.
      if (patch.convertEngine !== undefined) {
        next.useLocalOCR = patch.convertEngine !== "cloud";
        next.localOCRFirst = patch.convertEngine !== "cloud";
      }

      // Offline/Online are the master switches, and at least one has to stay on or
      // the app can do nothing at all. Turning off the last one is refused outright
      // rather than silently flipping the other one on: a click that enables the
      // switch you did not press is indistinguishable from a bug. The UI keeps the
      // last remaining switch non-clickable, so this is only a backstop.
      if (patch.offlineEnabled === false && !next.onlineEnabled) next.offlineEnabled = true;
      if (patch.onlineEnabled === false && !next.offlineEnabled) next.onlineEnabled = true;

      // Keep the conversion engine reachable. With Online off, a "cloud"/"both"
      // engine can still be honoured when the selected provider is itself local
      // (Ollama on localhost, WebLLM in-browser) — forcing those back to
      // Pix2Text-only would silently discard a working offline vision model.
      // Only a genuinely hosted provider is unreachable and gets coerced.
      const activeIsOffline = isOfflineProvider(providerIdOverride ?? s.activeProviderId);
      if (!next.onlineEnabled && next.convertEngine !== "local" && !activeIsOffline) {
        next.convertEngine = "local";
        next.useLocalOCR = true;
        next.localOCRFirst = true;
      } else if (!next.offlineEnabled && next.convertEngine !== "cloud") {
        next.convertEngine = "cloud";
        next.useLocalOCR = false;
        next.localOCRFirst = false;
      }
      return { ...s, settings: next };
    });
  }, []);

  // ── Conversations ──────────────────────────────────────────────────────
  const newConversation = useCallback(() => {
    const id = "conv_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const conv: Conversation = {
      id,
      title: "New chat",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      provider: activeProviderId,
      model: activeModelId,
    };
    setState((s) => ({
      ...s,
      conversations: [conv, ...s.conversations].slice(0, s.settings.maxChatHistory || 30),
      activeConversationId: id,
    }));
    return id;
  }, [activeProviderId, activeModelId]);

  const selectConversation = useCallback((id: string | null) => {
    setState((s) => ({ ...s, activeConversationId: id }));
  }, []);

  const updateConversation = useCallback((id: string, patch: Partial<Conversation>) => {
    setState((s) => ({
      ...s,
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c)),
    }));
  }, []);

  const deleteConversation = useCallback((id: string) => {
    setState((s) => {
      const conversations = s.conversations.filter((c) => c.id !== id);
      const activeConversationId = s.activeConversationId === id ? (conversations[0]?.id || null) : s.activeConversationId;
      return { ...s, conversations, activeConversationId };
    });
  }, []);

  const setConversationMessages = useCallback((id: string, messages: ChatMessage[]) => {
    setState((s) => ({
      ...s,
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, messages, updatedAt: Date.now(), title: c.title === "New chat" && messages.length > 0 ? deriveTitle(messages) : c.title } : c,
      ),
    }));
  }, []);

  const renameConversation = useCallback((id: string, title: string) => {
    setState((s) => ({
      ...s,
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, title: title.trim() || "Untitled" } : c)),
    }));
  }, []);

  // ── Toasts ─────────────────────────────────────────────────────────────
  const pushToast = useCallback((t: Omit<ToastMsg, "id">) => {
    const id = "toast_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const toast: ToastMsg = { id, duration: 4000, tone: "default", ...t };
    setToasts((prev) => [...prev, toast]);
    if (toast.duration && toast.duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== id));
      }, toast.duration);
    }
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  // ── Theme ──────────────────────────────────────────────────────────────
  const setTheme = useCallback((t: ThemeChoice) => {
    setState((s) => ({ ...s, theme: t, settings: { ...s.settings, theme: t } }));
  }, []);

  // Cycles rather than toggles, because there are three choices and only one
  // header button. Order is dark → light → system so the two explicit modes are
  // one click apart and "system" is the resting state you land back on.
  const toggleTheme = useCallback(() => {
    setState((s) => {
      const next: ThemeChoice = s.theme === "dark" ? "light" : s.theme === "light" ? "system" : "dark";
      return { ...s, theme: next, settings: { ...s.settings, theme: next } };
    });
  }, []);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) || null,
    [conversations, activeConversationId],
  );

  const value: StoreValue = {
    providers,
    settings,
    activeProviderId,
    activeModelId,
    activeProvider,
    activeModel,
    isVision: activeModel.vision,
    setActiveProvider,
    setActiveModel,
    updateProvider,
    addProvider,
    removeProvider,
    duplicateProvider,
    resetProviders,
    updateSettings,
    conversations,
    activeConversationId,
    activeConversation,
    newConversation,
    selectConversation,
    updateConversation,
    deleteConversation,
    setConversationMessages,
    renameConversation,
    toasts,
    pushToast,
    dismissToast,
    theme,
    resolvedTheme,
    setTheme,
    toggleTheme,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "New chat";
  const text = firstUser.content.trim().split("\n")[0].slice(0, 60);
  return text || "New chat";
}

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used within StoreProvider");
  return v;
}
