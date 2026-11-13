import { useCallback, useEffect, useState } from "react";
import { StoreProvider, useStore } from "@/store";
import type { ConvertResult, ThemeChoice } from "@/types";
import { cn } from "@/utils/cn";
import { ProviderPicker } from "@/components/ProviderPicker";
import { ConvertTab } from "@/components/ConvertTab";
import { LatexTab } from "@/components/LatexTab";
import { MathTypeTab } from "@/components/MathTypeTab";
import { ChatTab } from "@/components/ChatTab";
import { ProvidersTab } from "@/components/ProvidersTab";
import { SettingsTab } from "@/components/SettingsTab";
import { ExportModal } from "@/components/ExportModal";
import { AboutTab } from "@/components/AboutTab";
import { MathoriumMark } from "@/components/Brand";
import { APP_AUTHOR, APP_NAME, APP_VERSION } from "@/lib/version";
import { Badge, Button } from "@/components/ui";
import { CommandPalette, type Command } from "@/components/CommandPalette";
import { ShortcutsHelp } from "@/components/ShortcutsHelp";
import { Toaster } from "@/components/Toaster";
import { OnboardingHint } from "@/components/OnboardingHint";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SnipLibraryTab } from "@/components/SnipLibraryTab";
import { loadDesktopLibrary, saveDesktopLibrary } from "@/lib/desktopLibrary";
import { useHotkey } from "@/lib/hooks";

type Tab = "convert" | "library" | "latex" | "mathtype" | "chat" | "providers" | "settings" | "about";

/** One header button cycles all three theme choices, so it needs a label, an
 *  icon and a successor for each. "System" shows a monitor rather than a
 *  sun/moon because its appearance is not the app's to promise. */
const THEME_LABEL: Record<ThemeChoice, string> = { dark: "Dark", light: "Light", system: "System" };
const THEME_ICON: Record<ThemeChoice, string> = { dark: "☾", light: "☀", system: "🖥" };
const NEXT_THEME: Record<ThemeChoice, ThemeChoice> = { dark: "light", light: "system", system: "dark" };

const NAV: { id: Tab; label: string; icon: string; hotkey?: string }[] = [
  { id: "convert", label: "Convert", icon: "🖼️", hotkey: "g c" },
  { id: "library", label: "Snip Library", icon: "📚", hotkey: "g i" },
  { id: "latex", label: "LaTeX Tool", icon: "∑", hotkey: "g l" },
  { id: "mathtype", label: "MathType", icon: "𝑓", hotkey: "g m" },
  { id: "chat", label: "Chat", icon: "💬", hotkey: "g h" },
  { id: "providers", label: "Providers", icon: "🔌", hotkey: "g p" },
  { id: "settings", label: "Settings", icon: "⚙️", hotkey: "g s" },
  { id: "about", label: "About", icon: "ℹ️" },
];

const TAB_IDS = NAV.map((n) => n.id);

/** `?tab=chat` opens that tab directly. The PWA manifest's shortcuts point here,
 *  and it gives a shareable link to a specific tool. Unknown values fall back to
 *  Convert rather than rendering nothing. */
function tabFromUrl(): Tab {
  try {
    const want = new URLSearchParams(window.location.search).get("tab");
    return TAB_IDS.includes(want as Tab) ? (want as Tab) : "convert";
  } catch {
    return "convert";
  }
}

function Shell() {
  const [tab, setTab] = useState<Tab>(tabFromUrl);
  const [results, setResults] = useState<ConvertResult[]>([]);
  const [libraryReady, setLibraryReady] = useState(false);
  const [desktopCaptures, setDesktopCaptures] = useState<Array<{id:string;dataUrl:string;fileName:string}>>([]);
  const consumeDesktopCapture = useCallback((id: string) => {
    setDesktopCaptures(prev => prev.filter(item => item.id !== id));
  }, []);
  const [exportOpen, setExportOpen] = useState(false);
  const [latexTarget, setLatexTarget] = useState<{ resultId: string; exprIndex: number } | null>(null);
  const [mathTypeTarget, setMathTypeTarget] = useState<{ resultId: string; exprIndex: number } | null>(null);
  const [mathTypeSeed, setMathTypeSeed] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const { activeProvider, toggleTheme, setTheme, theme, resolvedTheme, pushToast, newConversation, settings, updateSettings } = useStore();

  // Desktop OCR is deliberately local-only. Cloud chat/provider features remain
  // separate, but screenshot bytes are never routed through them.
  useEffect(() => {
    const desktop = window.mathoriumDesktop;
    if (!desktop?.isDesktop) return;
    updateSettings({ convertEngine: "local", offlineEnabled: true, onlineEnabled: false });
    const offCapture = desktop.onCapture((capture) => {
      setDesktopCaptures(prev => [...prev, { id: crypto.randomUUID(), dataUrl: capture.dataUrl, fileName: capture.fileName }]);
      setTab("convert");
    });
    const offImport = desktop.onImportRequest(async () => {
      try {
        const files = await desktop.chooseImages();
        if (files.length) {
          setDesktopCaptures(prev => [...prev, ...files.map(file => ({ id: crypto.randomUUID(), dataUrl: file.dataUrl, fileName: file.name }))]);
          setTab("convert");
        }
      } catch (error) { pushToast({ title: "Could not open images", description: error instanceof Error ? error.message : String(error), tone: "error" }); }
    });
    return () => { offCapture(); offImport(); };
  }, [updateSettings, pushToast]);

  // Keep the address bar honest about which tool is open, so a tab can be
  // bookmarked or shared. `replaceState` rather than `pushState`: switching tabs
  // is not navigation, and stacking history entries would turn Back into
  // "undo my last seven clicks" instead of "leave the app".
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (tab === "convert") url.searchParams.delete("tab");
      else url.searchParams.set("tab", tab);
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch {
      /* file:// and sandboxed frames refuse replaceState — the tab still works */
    }
  }, [tab]);

  // The desktop Snip Library stores images and recognition records in IndexedDB,
  // not localStorage, so large screenshots survive restarts and application updates.
  useEffect(() => {
    if (!window.mathoriumDesktop?.isDesktop) { setLibraryReady(true); return; }
    let active = true;
    loadDesktopLibrary().then(items => { if (active) { setResults(items); setLibraryReady(true); } }).catch(() => { if (active) setLibraryReady(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!window.mathoriumDesktop?.isDesktop || !libraryReady) return;
    const timer = window.setTimeout(() => { void saveDesktopLibrary(results).catch(error => console.error("Snip Library save failed", error)); }, 500);
    return () => window.clearTimeout(timer);
  }, [results, libraryReady]);

  const doneCount = results.filter((r) => r.expressions.length > 0 || r.raw).length;

  const editInLatex = (resultId: string, exprIndex: number) => {
    setLatexTarget({ resultId, exprIndex });
    setTab("latex");
  };

  // "∑ MathType" on a result card. Same shape as editInLatex: the tab owns the editing,
  // this only says which expression to open, so the source image travels with it.
  const editInMathType = (resultId: string, exprIndex: number) => {
    setMathTypeTarget({ resultId, exprIndex });
    setTab("mathtype");
  };

  // "∑ MathType" on the LaTeX tab, where the expression is a line of free-form text with
  // nothing to link to, so it goes across as a scratch equation.
  const openInMathType = (latex: string) => {
    setMathTypeSeed(latex);
    setTab("mathtype");
  };

  // Global hotkeys
  useHotkey("mod+k", () => setPaletteOpen(true), []);
  useHotkey("?", () => setShortcutsOpen(true), []);
  useHotkey("mod+shift+l", () => toggleTheme(), [], { allowInInput: true });
  useHotkey("mod+shift+n", () => { newConversation(); setTab("chat"); }, []);
  useHotkey("g c", () => setTab("convert"), []);
  useHotkey("g i", () => setTab("library"), []);
  useHotkey("g l", () => setTab("latex"), []);
  useHotkey("g m", () => setTab("mathtype"), []);
  useHotkey("g h", () => setTab("chat"), []);
  useHotkey("g p", () => setTab("providers"), []);
  useHotkey("g s", () => setTab("settings"), []);
  useHotkey("mod+e", () => { if (doneCount) setExportOpen(true); }, []);

  const commands: Command[] = [
    { id: "go-convert", label: "Go to Convert", group: "Navigate", icon: "🖼️", shortcut: ["G", "C"], run: () => setTab("convert") },
    { id: "go-library", label: "Open Snip Library", group: "Navigate", icon: "📚", shortcut: ["G", "I"], run: () => setTab("library") },
    { id: "go-latex", label: "Go to LaTeX Tool", group: "Navigate", icon: "∑", shortcut: ["G", "L"], run: () => setTab("latex") },
    { id: "go-mathtype", label: "Go to MathType", group: "Navigate", icon: "𝑓", shortcut: ["G", "M"], run: () => setTab("mathtype") },
    { id: "go-chat", label: "Go to Chat", group: "Navigate", icon: "💬", shortcut: ["G", "H"], run: () => setTab("chat") },
    { id: "go-providers", label: "Go to Providers", group: "Navigate", icon: "🔌", shortcut: ["G", "P"], run: () => setTab("providers") },
    { id: "go-settings", label: "Go to Settings", group: "Navigate", icon: "⚙️", shortcut: ["G", "S"], run: () => setTab("settings") },
    { id: "go-about", label: "Go to About", group: "Navigate", icon: "ℹ️", run: () => setTab("about") },
    { id: "new-chat", label: "New chat", group: "Action", icon: "＋", shortcut: ["⌘⇧N"], run: () => { newConversation(); setTab("chat"); } },
    { id: "export", label: "Export results", group: "Action", icon: "⤓", shortcut: ["⌘E"], run: () => doneCount && setExportOpen(true) },
    { id: "toggle-theme", label: `Theme: ${THEME_LABEL[theme]} → switch to ${THEME_LABEL[NEXT_THEME[theme]]}`, group: "Theme", icon: THEME_ICON[theme], shortcut: ["⌘⇧L"], run: () => { const next = NEXT_THEME[theme]; setTheme(next); pushToast({ title: `Theme: ${THEME_LABEL[next]}`, description: next === "system" ? "Following your operating system — it will change with it." : undefined, tone: "info", duration: 2200 }); } },
    { id: "theme-dark", label: "Use dark theme", group: "Theme", icon: "☾", run: () => setTheme("dark") },
    { id: "theme-light", label: "Use light theme", group: "Theme", icon: "☀", run: () => setTheme("light") },
    { id: "theme-system", label: "Match system theme", group: "Theme", icon: "🖥", run: () => setTheme("system") },
    { id: "show-shortcuts", label: "Show all shortcuts", group: "Help", icon: "?", shortcut: ["?"], run: () => setShortcutsOpen(true) },
    { id: "show-palette", label: "Open command palette", group: "Help", icon: "⌘K", shortcut: ["⌘K"], run: () => setPaletteOpen(true) },
  ];

  return (
    <div className="relative z-10 flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-white/8 bg-[var(--surface-app)]/85 backdrop-blur-xl">
        <div className="flex w-full flex-wrap items-center gap-3 px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed })}
              className="hidden rounded-lg border border-white/10 bg-white/5 p-2 text-slate-400 hover:bg-white/10 hover:text-white md:block"
              title={settings.sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
            </button>
            <MathoriumMark size={36} className="shrink-0 drop-shadow-lg" title={APP_NAME} />
            <div className="leading-tight">
              <div className="flex items-center gap-2 font-semibold text-white">
                {APP_NAME}
                <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-cyan-300">v{APP_VERSION}</span>
                {activeProvider.free && <Badge tone="green">Free · no key</Badge>}
              </div>
              <div className="text-[10px] text-slate-500">AI Math OCR · LaTeX / MathML Studio · by <b className="text-slate-400">{APP_AUTHOR}</b></div>
            </div>
          </div>

          {/* On a phone this takes a full row of its own — sharing the line with
              the logo left it 17px wide and pushed the provider selects off the
              viewport. From sm up it goes back to sitting right-aligned beside
              the logo. flex-wrap lets the picker drop to a second row when even
              a full width is not enough. */}
          <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:ml-auto sm:w-auto sm:flex-1">
            {/* Offline / Online master switches.
                These are two independent on/off switches, not a two-way choice, and
                the old rendering read as the latter: both looked like tabs, so
                clicking the lit one to "select" it turned it off instead, and the
                other lighting up looked like the click had gone to the wrong button.
                Now each carries its own ON/OFF pip, and the last one still enabled is
                locked — there is nothing sensible to do with an app that has neither
                local nor hosted providers, so the click is refused with a reason
                rather than quietly rearranged. */}
            <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
              <ModeSwitch
                label="Offline"
                icon="📴"
                on={settings.offlineEnabled}
                locked={settings.offlineEnabled && !settings.onlineEnabled}
                tone="violet"
                hint="Local providers that need no network: Pix2Text OCR, WebLLM, local GGUF, Ollama"
                onToggle={() => updateSettings({ offlineEnabled: !settings.offlineEnabled })}
                onLocked={() => pushToast({ title: "Offline must stay on", description: "Online is off, so turning Offline off would leave no providers at all.", tone: "info", duration: 4000 })}
              />
              <ModeSwitch
                label="Online"
                icon="🌐"
                on={settings.onlineEnabled}
                locked={settings.onlineEnabled && !settings.offlineEnabled}
                tone="emerald"
                hint="Hosted providers reached over the network: LLM7, Puter, Gemini, Groq and the rest"
                onToggle={() => updateSettings({ onlineEnabled: !settings.onlineEnabled })}
                onLocked={() => pushToast({ title: "Online must stay on", description: "Offline is off, so turning Online off would leave no providers at all.", tone: "info", duration: 4000 })}
              />
            </div>
            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-400 hover:bg-white/10 hover:text-white sm:flex"
              title="Command palette (⌘K)"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              <span>Search…</span>
              <kbd className="rounded border border-white/15 bg-white/5 px-1 py-0.5 text-[9px]">⌘K</kbd>
            </button>
            <button
              onClick={toggleTheme}
              className="rounded-lg border border-white/10 bg-white/5 p-2 text-slate-400 hover:bg-white/10 hover:text-white"
              title={`Theme: ${THEME_LABEL[theme]}${theme === "system" ? ` (following your OS — currently ${resolvedTheme})` : ""} · click for ${THEME_LABEL[NEXT_THEME[theme]]} (⌘⇧L)`}
              aria-label={`Theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[NEXT_THEME[theme]]}`}
            >
              {THEME_ICON[theme]}
            </button>
            <ProviderPicker mode={tab === "convert" ? "vision" : "text"} />
            {window.mathoriumDesktop?.isDesktop && <Button variant="primary" size="sm" onClick={() => void window.mathoriumDesktop?.startCapture()} title="Capture a formula anywhere on your screen (Ctrl+Alt+M)">▧ New Snip</Button>}
            <Button variant="success" size="sm" disabled={!doneCount} onClick={() => setExportOpen(true)} title="Export results (⌘E)">
              ⤓ Export{doneCount ? ` (${doneCount})` : ""}
            </Button>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto border-t border-white/8 px-2 py-1.5 md:hidden">
          {NAV.map((n) => (
            <button key={n.id} onClick={() => setTab(n.id)} className={cn("flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium", tab === n.id ? "bg-white/10 text-white" : "text-slate-400")}>
              <span>{n.icon}</span>{n.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="flex w-full flex-1 gap-0">
        <aside
          className={cn(
            "sticky top-[57px] hidden h-[calc(100vh-57px)] shrink-0 flex-col border-r border-white/8 p-3 transition-all md:flex",
            settings.sidebarCollapsed ? "w-16 items-center" : "w-52",
          )}
        >
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setTab(n.id)}
              title={settings.sidebarCollapsed ? n.label : undefined}
              className={cn(
                "mb-1 flex items-center gap-3 rounded-xl py-2.5 text-sm font-medium transition",
                settings.sidebarCollapsed ? "w-10 justify-center px-0" : "w-full px-3",
                tab === n.id ? "bg-gradient-to-r from-violet-500/20 to-indigo-500/10 text-white ring-1 ring-violet-400/30" : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
              )}
            >
              <span className="text-base">{n.icon}</span>
              {!settings.sidebarCollapsed && n.label}
            </button>
          ))}
          {!settings.sidebarCollapsed && (
            <div className="mt-auto rounded-xl border border-white/8 bg-white/[0.02] p-3 text-[11px] leading-relaxed text-slate-500">
              <div className="mb-1 font-semibold text-slate-400">100% client-side · v{APP_VERSION}</div>
              Math OCR runs offline on <span className="text-cyan-300">Pix2Text</span> — no key, no network. Free text chat with no key: <span className="text-emerald-300">LLM7</span>, or <span className="text-violet-300">WebLLM</span> offline. Keyless cloud vision: <span className="text-orange-300">Puter</span>.
              <div className="mt-2 flex items-center gap-1">
                <button onClick={() => setPaletteOpen(true)} className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-white/10">
                  ⌘K palette
                </button>
                <button onClick={() => setShortcutsOpen(true)} className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-white/10">
                  ? help
                </button>
              </div>
            </div>
          )}
        </aside>

        <main className="min-w-0 flex-1 px-4 py-5 md:px-6">
          {tab === "library" && <SnipLibraryTab items={results}
            onRename={(id,name) => setResults(prev => prev.map(item => item.id === id ? {...item,displayName:name} : item))}
            onDelete={(id) => setResults(prev => prev.filter(item => item.id !== id))}
            onToggleFavorite={(id) => setResults(prev => prev.map(item => item.id === id ? {...item,favorite:!item.favorite} : item))}
            onCopy={(latex) => { if (window.mathoriumDesktop?.isDesktop) void window.mathoriumDesktop.writeClipboard(latex); else void navigator.clipboard.writeText(latex); }}
            onEditLatex={editInLatex} onEditMathType={editInMathType} />}
          {tab === "convert" && <ConvertTab results={results} setResults={setResults} onExport={() => setExportOpen(true)} onEditInLatex={editInLatex} onEditInMathType={editInMathType} desktopCaptures={desktopCaptures} onDesktopCaptureConsumed={consumeDesktopCapture} />}
          {tab === "latex" && <LatexTab results={results} setResults={setResults} target={latexTarget} setTarget={setLatexTarget} onOpenInMathType={openInMathType} />}
          {tab === "mathtype" && <MathTypeTab results={results} setResults={setResults} target={mathTypeTarget} setTarget={setMathTypeTarget} seed={mathTypeSeed} onSeedConsumed={() => setMathTypeSeed(null)} />}
          {tab === "chat" && <ChatTab />}
          {tab === "providers" && <ProvidersTab />}
          {tab === "settings" && <SettingsTab />}
          {tab === "about" && <AboutTab />}
        </main>
      </div>

      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} results={results} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
      <ShortcutsHelp open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <Toaster />
      <OnboardingHint />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </ErrorBoundary>
  );
}

/**
 * One master switch, showing its own state rather than implying a choice between
 * two. `locked` marks the last one still on: it stays lit and explains itself when
 * clicked, instead of accepting a click whose only possible outcome is to turn on
 * the switch beside it.
 */
function ModeSwitch({
  label,
  icon,
  on,
  locked,
  tone,
  hint,
  onToggle,
  onLocked,
}: {
  label: string;
  icon: string;
  on: boolean;
  locked: boolean;
  tone: "violet" | "emerald";
  hint: string;
  onToggle: () => void;
  onLocked: () => void;
}) {
  const lit =
    tone === "violet"
      ? "bg-violet-500/25 text-violet-100 ring-1 ring-violet-400/40"
      : "bg-emerald-500/25 text-emerald-100 ring-1 ring-emerald-400/40";
  const pip = tone === "violet" ? "bg-violet-400" : "bg-emerald-400";

  return (
    <button
      onClick={locked ? onLocked : onToggle}
      aria-pressed={on}
      className={cn(
        "flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition",
        on ? lit : "text-slate-500 hover:bg-white/5 hover:text-slate-300",
        locked && "cursor-default",
      )}
      title={
        locked
          ? `${label} is the only mode left on — turn the other one on first.\n\n${hint}`
          : `${on ? "Turn off" : "Turn on"} ${label} providers.\n\n${hint}`
      }
    >
      <span className={cn("h-1.5 w-1.5 rounded-full transition", on ? pip : "bg-slate-600")} />
      <span>{icon} {label}</span>
      <span className={cn("text-[9px] font-bold uppercase tracking-wide", on ? "opacity-70" : "opacity-50")}>
        {on ? "on" : "off"}
      </span>
    </button>
  );
}
