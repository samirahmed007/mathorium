import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import type { AgentStep, ChatAttachment, ChatMessage } from "@/types";
import { useStore } from "@/store";
import { chatReply, chatReplyStream } from "@/lib/llm";
import { agentReplyStream, AGENT_SYSTEM_SUFFIX, type AgentEvent } from "@/lib/agent";
import { AgentTrace } from "./AgentTrace";
import { ThinkingPanel } from "./ThinkingPanel";
import { MarkdownView, markdownToPlainText } from "./MarkdownView";
import { MathoriumMark } from "./Brand";
import { Badge, Button, Select, Spinner, TypingDots } from "./ui";
import { copyText, download, fileToDataUrl, slugify, uid } from "@/lib/utils";
import { IMAGE_PRESETS, PERCHANCE_URL, downloadImage, generateImage, listImageEngines, perchanceHandoff, rerollImage } from "@/lib/imageGen";
import { estimateConversationTokens, formatTokenCount } from "@/lib/tokens";
import { APP_NAME } from "@/lib/version";
import { useAutoResizeTextarea } from "@/lib/hooks";
import { useSpeechInput, VOICE_LANGS } from "@/hooks/useSpeechInput";
import { ChatHistorySidebar } from "./ChatHistorySidebar";
import { Popover } from "./Popover";
import {
  IconAgent, IconArchive, IconCheck, IconClose, IconCode, IconCopy, IconDice,
  IconDownload, IconEdit, IconExpand, IconFile, IconImage, IconMenu, IconMic,
  IconPaperclip, IconPlus, IconRefresh, IconSend, IconSparkles, IconStop,
} from "./icons";
// @ts-ignore
import JSZip from "jszip";

const SYSTEM = `You are the Mathorium Assistant, a world-class mathematician, engineer and LaTeX/typesetting expert.
- You can perform ANY task: solve, explain, simplify, differentiate, integrate, prove, transcribe, and also write code, analyze files, and reason step by step.
- ALWAYS typeset math with LaTeX: inline as $...$ and display as $$...$$.
- When the user attaches files (including extracted ZIP contents), read and use their contents to complete the task precisely.
- When you produce code, wrap it in fenced code blocks with the language, e.g. \`\`\`python ... \`\`\`.
- Use Markdown for structure: headings, lists, bold, tables when useful. Be precise, concise, and verify final results.`;

const SUGGESTIONS = [
  { icon: "♾️", text: "Solve $x^2 - 5x + 6 = 0$ and show steps" },
  { icon: "📝", text: "Convert this to LaTeX: integral of sin(x)^2" },
  { icon: "📚", text: "Explain the chain rule with an example" },
  { icon: "💻", text: "Write a Python function for Fibonacci numbers" },
];

const IMG_SUGGESTIONS = [
  "A futuristic graph of a sine wave, neon colors",
  "Geometric fractal pattern, sacred geometry",
  "Cute robot holding a chalkboard with equations",
  "Abstract 3D visualization of a Riemann surface",
];

const TEXT_EXT = /\.(txt|md|markdown|tex|latex|json|csv|tsv|js|jsx|ts|tsx|py|java|c|cpp|h|hpp|cs|go|rs|rb|php|sh|bash|sql|html|css|xml|yaml|yml|toml|ini|log|env|ps1|scala|kt|swift|dart|r|m|jl|vue|svelte)$/i;

function fileIcon(kind: string, name: string) {
  const cls = "h-3.5 w-3.5 shrink-0 text-slate-400";
  if (kind === "image") return <IconImage size={14} className={cls} />;
  if (kind === "zip") return <IconArchive size={14} className={cls} />;
  if (/\.(py|js|ts|tsx|jsx|java|c|cpp|go|rs|rb|php|sh|sql)$/i.test(name)) return <IconCode size={14} className={cls} />;
  return <IconFile size={14} className={cls} />;
}

/**
 * One row of the composer's `+` menu.
 *
 * Attaching a file, attaching an image and generating one are the same kind of
 * decision — "what goes into this message" — so they read as a list with labels
 * rather than as three unlabelled glyphs the user has to hover to identify.
 */
function MenuItem({
  icon,
  label,
  hint,
  onClick,
  disabled,
  active,
}: {
  /** Optional: a list of like-for-like choices (the dictation languages) reads
   *  better without a column of identical glyphs. */
  icon?: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "flex w-full items-center gap-2.5 px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40 " +
        (active ? "bg-violet-500/15 text-violet-200" : "text-slate-200 hover:bg-white/6")
      }
    >
      {icon && <span className={active ? "text-violet-300" : "text-slate-400"}>{icon}</span>}
      <span className="min-w-0">
        <span className="block text-[12.5px] leading-tight">{label}</span>
        {hint && <span className="block text-[10.5px] leading-tight text-slate-500">{hint}</span>}
      </span>
      {active && <IconCheck size={14} className="ml-auto text-violet-300" />}
    </button>
  );
}

/**
 * A composer tool button. Smaller and quieter than the shared `Button`, because a
 * row of full-weight buttons under the input competes with Send for attention when
 * none of them is the thing the user came to press.
 */
function ToolChip({
  children,
  title,
  onClick,
  active,
  disabled,
  tone = "accent",
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  tone?: "accent" | "danger";
}) {
  const on = tone === "danger" ? "bg-rose-500/20 text-rose-200 ring-1 ring-rose-400/30" : "bg-violet-500/20 text-violet-200 ring-1 ring-violet-400/30";
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={
        "flex h-7 w-7 items-center justify-center rounded-lg text-[13px] transition disabled:opacity-30 disabled:pointer-events-none " +
        (active ? on : "text-slate-400 hover:bg-white/8 hover:text-white")
      }
    >
      {children}
    </button>
  );
}

function attachmentsContext(atts: ChatAttachment[]): string {
  const parts: string[] = [];
  for (const a of atts) {
    if (a.kind === "image") continue;
    if (a.kind === "text" && a.text) parts.push(`=== FILE: ${a.name} ===\n${a.text.slice(0, 60000)}${a.text.length > 60000 ? "\n…(truncated)" : ""}`);
    else if (a.kind === "zip" && a.files) {
      parts.push(`=== ZIP: ${a.name} (${a.files.length} files extracted) ===`);
      for (const f of a.files) parts.push(f.text ? `--- ${f.name} ---\n${f.text.slice(0, 20000)}` : `--- ${f.name} --- (binary, ${f.note || "not text"})`);
    } else if (a.kind === "binary") parts.push(`(Attached binary file: ${a.name}, ${Math.round(a.size / 1024)} KB — cannot read contents)`);
  }
  return parts.join("\n\n");
}

export function ChatTab() {
  const {
    activeProvider,
    activeModelId,
    providers,
    settings,
    updateSettings,
    isVision,
    activeConversation,
    activeConversationId,
    newConversation,
    setConversationMessages,
    pushToast,
  } = useStore();

  // Local UI state — mirrors the active conversation's messages
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  /**
   * Which continuation round is in flight (0 = none). A reply that hit the
   * provider's token cap is resumed automatically; without an indicator the
   * pause between rounds reads as the app having hung.
   */
  const [continuing, setContinuing] = useState(0);
  /**
   * The message whose agent trace is still being written. The phases themselves are
   * rendered inside that message's bubble, not down in the composer: by the time the
   * audit runs the answer is already on screen, and a composer line reading "planning"
   * under a finished reply describes work that is over.
   */
  const [agentRunId, setAgentRunId] = useState<string | null>(null);
  /**
   * The message currently being written. `agentRunId` cannot stand in for this: it is
   * only set in Agent Mode, and a reasoning model streams its thoughts either way.
   */
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyAttach, setBusyAttach] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // image-gen mode
  const [imgMode, setImgMode] = useState(false);
  const [imgModel, setImgModel] = useState("sana");
  const [imgPreset, setImgPreset] = useState("1:1");
  const [imgError, setImgError] = useState("");

  /**
   * The engines on offer: the keyless built-ins plus every image model the user's
   * own providers reported, so a provider that adds one is picked up by "Fetch
   * live" rather than by an app update.
   */
  const imageEngines = useMemo(() => listImageEngines(providers), [providers]);
  const imageEngine = imageEngines.find((e) => e.id === imgModel) ?? imageEngines[0];

  // fullscreen image viewer
  const [fullscreenImg, setFullscreenImg] = useState<{ url: string; prompt: string } | null>(null);

  // chat history sidebar
  const [historyOpen, setHistoryOpen] = useState(false);

  // Voice input. The transcript is written straight into the composer, so the
  // hook owns the "what has been said so far" bookkeeping that a naive
  // implementation gets wrong (see useSpeechInput).
  const voice = useSpeechInput({ value: input, onText: setInput });
  const [voiceLangOpen, setVoiceLangOpen] = useState(false);
  const [voiceLangEl, setVoiceLangEl] = useState<HTMLElement | null>(null);

  // The composer's "+" menu — attach an image, attach files, or generate a picture.
  const [plusOpen, setPlusOpen] = useState(false);
  const [plusEl, setPlusEl] = useState<HTMLElement | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const taRef = useAutoResizeTextarea(input, 8);

  // Sync local messages with active conversation
  useEffect(() => {
    if (activeConversation) {
      setMessages(activeConversation.messages);
    } else {
      setMessages([]);
    }
    setEditingId(null);
    setInput("");
    setImages([]);
    setAttachments([]);
  }, [activeConversationId]);

  // Auto-create conversation on first message if none active
  useEffect(() => {
    if (!activeConversationId && messages.length === 0) {
      // Don't auto-create; wait for first send.
    }
  }, [activeConversationId, messages.length]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Dismiss the "+" menu on an outside click or Esc. It is portalled to the body, so
  // `contains` has to be asked of the menu element itself, not of the composer.
  useEffect(() => {
    if (!plusOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (plusEl?.contains(t)) return;
      if ((t as HTMLElement).closest?.("[data-popover]")) return;
      setPlusOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPlusOpen(false); };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [plusOpen, plusEl]);

  // Esc closes fullscreen image
  useEffect(() => {
    if (!fullscreenImg) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreenImg(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreenImg]);

  const visible = messages.filter((m) => m.role !== "system");

  // Agent Mode defaults to on, so state persisted before v8 (where the flag is
  // absent) must read as enabled rather than falling back to off.
  const agentOn = settings.agentMode !== false;

  // Estimated context size for what the next send will carry: the system prompt,
  // the conversation so far, and whatever is currently in the box.
  const inputTokens = estimateConversationTokens([
    { role: "system", content: SYSTEM + (agentOn ? AGENT_SYSTEM_SUFFIX : "") },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input },
  ]);

  const copy = (id: string, text: string) => { copyText(text); setCopiedId(id); setTimeout(() => setCopiedId(null), 1200); };

  const runChat = async (history: ChatMessage[]) => {
    // Ensure a conversation exists
    let convId = activeConversationId;
    if (!convId) {
      convId = newConversation();
    }

    const asstId = uid("a");
    const newMsgs: ChatMessage[] = [...history, { id: asstId, role: "assistant", content: "", createdAt: Date.now(), pending: true, provider: activeProvider.id, model: activeModelId }];
    setMessages(newMsgs);
    setConversationMessages(convId, newMsgs);
    setLoading(true);
    setStreamingId(asstId);
    const ac = new AbortController();
    abortRef.current = ac;
    const sendHistory: ChatMessage[] = [{ id: "sys", role: "system", content: SYSTEM + (agentOn ? AGENT_SYSTEM_SUFFIX : ""), createdAt: 0 }, ...history.map((m) => {
      if (m.role === "user" && m.attachments?.length) {
        const ctx = attachmentsContext(m.attachments);
        return { ...m, content: ctx ? m.content + "\n\n[Attached file contents]\n" + ctx : m.content };
      }
      return m;
    })];
    let acc = "";
    let switchedTo = "";
    // The model that actually produced the reply. On a fallback this differs
    // from `activeModelId`, and labelling the bubble with the model the user
    // selected would credit the answer to something that never ran.
    let switchedModel = "";

    /**
     * Written onto the message rather than held in component state, so the trace and
     * the thinking survive a reload and a conversation switch. Declared out here
     * because the transport needs it for `onReasoning` before the event loop starts.
     */
    const patchMsg = (patch: Partial<ChatMessage>) => {
      setMessages((prev) => {
        const next = prev.map((m) => (m.id === asstId ? { ...m, ...patch } : m));
        if (convId) setConversationMessages(convId, next);
        return next;
      });
    };

    // The model's chain of thought, kept out of `acc` so the answer bubble holds
    // only the answer. See lib/thinking for where the two are separated.
    let reasoningAcc = "";
    const onReasoning = (delta: string) => {
      reasoningAcc += delta;
      patchMsg({ reasoning: reasoningAcc });
    };

    try {
      let firstChunk = true;
      const onProviderSwitch = (pid: string, reason: string, modelId?: string) => {
        switchedTo = pid;
        switchedModel = modelId || "";
        pushToast({
          title: modelId ? `Auto-switched to ${pid} · ${modelId}` : `Auto-switched to ${pid}`,
          description: reason,
          tone: "info",
          duration: 6000,
        });
      };
      const base = {
        provider: activeProvider,
        model: activeModelId,
        settings,
        history: sendHistory,
        signal: ac.signal,
        onProviderSwitch,
        // The answer hit the provider's token cap and is being resumed. Say so,
        // otherwise a long pause mid-sentence looks like a stall.
        onContinue: (round: number) => setContinuing(round),
        onReasoning,
      };

      // Agent Mode runs several passes and can replace the draft wholesale, so
      // both paths are normalised to the same event stream rather than the plain
      // chunk-of-text one the single-pass transport yields.
      const events: AsyncGenerator<AgentEvent, void, unknown> = agentOn
        ? agentReplyStream({ ...base, depth: settings.agentDepth ?? "balanced" })
        : (async function* () {
            for await (const chunk of chatReplyStream(base)) yield { kind: "delta", text: chunk } as AgentEvent;
          })();

      if (agentOn) setAgentRunId(asstId);

      /**
       * The trace is accumulated here and written onto the message, so it survives a
       * reload and a conversation switch. Mutating a local array and copying it on
       * each event keeps the reducer below a pure function of what just arrived.
       */
      const steps: AgentStep[] = [];

      for await (const ev of events) {
        // Stop must be immediate. Aborting the controller cancels the fetch, but a
        // generator can still yield chunks it had already buffered, so the loop is
        // broken here as well — otherwise text keeps appearing after the click.
        if (ac.signal.aborted) break;

        if (ev.kind === "step-start") {
          steps.push({ id: ev.id, phase: ev.phase, label: ev.label, text: "", status: "running", startedAt: Date.now() });
          patchMsg({ agentSteps: [...steps] });
          continue;
        }
        if (ev.kind === "step-delta") {
          const s = steps.find((x) => x.id === ev.id);
          if (s) {
            s.text += ev.text;
            patchMsg({ agentSteps: steps.map((x) => ({ ...x })) });
          }
          continue;
        }
        if (ev.kind === "step-end") {
          const s = steps.find((x) => x.id === ev.id);
          if (s) {
            s.status = ev.status === "failed" ? "failed" : "done";
            s.endedAt = Date.now();
            if (ev.summary) s.summary = ev.summary;
            patchMsg({ agentSteps: steps.map((x) => ({ ...x })) });
          }
          continue;
        }

        if (ev.kind === "delta") acc += ev.text;
        else acc = ev.text;

        if (firstChunk) { firstChunk = false; patchMsg({ pending: false }); }
        patchMsg({ content: acc });
      }
      if (ac.signal.aborted) {
        // Aborting does not always surface as a throw — a generator that returns
        // cleanly on cancellation lands here. Without this branch the empty-reply
        // recovery below would fire a fresh request the user just asked to stop.
        setMessages((prev) => {
          const next = prev.map((m) =>
            m.id === asstId
              ? { ...m, content: acc.trim() ? acc + "\n\n*(stopped)*" : "*(stopped)*", pending: false }
              : m,
          );
          if (convId) setConversationMessages(convId, next);
          return next;
        });
        pushToast({ title: "Stopped", tone: "info", duration: 3000 });
      } else if (!acc.trim()) {
        const reply = await chatReply({
          provider: activeProvider,
          model: activeModelId,
          settings,
          history: sendHistory,
          signal: ac.signal,
          // Without this the non-streaming path would silently answer from a
          // different provider and still label the bubble with the selected one.
          onProviderSwitch: (pid, reason, modelId) => {
            switchedTo = pid;
            switchedModel = modelId || "";
            pushToast({
              title: modelId ? `Auto-switched to ${pid} · ${modelId}` : `Auto-switched to ${pid}`,
              description: reason,
              tone: "info",
              duration: 6000,
            });
          },
          onContinue: (round) => setContinuing(round),
          onReasoning,
        });
        setMessages((prev) => {
          const next = prev.map((m) => (m.id === asstId ? { ...m, content: reply, pending: false, provider: switchedTo || activeProvider.id, model: switchedModel || activeModelId } : m));
          if (convId) setConversationMessages(convId, next);
          return next;
        });
      } else if (switchedTo) {
        setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, provider: switchedTo, model: switchedModel || m.model } : m)));
      }
    } catch (e: unknown) {
      const aborted = ac.signal.aborted;
      const errMsg = e instanceof Error ? e.message : String(e);
      setMessages((prev) => {
        const next = prev.map((m) => (m.id === asstId ? { ...m, content: aborted ? (acc.trim() ? acc + "\n\n*(stopped)*" : "*(stopped)*") : acc, pending: false, error: aborted ? undefined : errMsg } : m));
        if (convId) setConversationMessages(convId, next);
        return next;
      });
      pushToast({ title: aborted ? "Stopped" : "Chat error", description: aborted ? undefined : errMsg, tone: aborted ? "info" : "error", duration: 6000 });
    } finally {
      setLoading(false);
      setContinuing(0);
      // Any pass still marked running was cut short by the abort or the throw above.
      // Leaving it spinning forever would claim work is happening after the run ended.
      setMessages((prev) => {
        const next = prev.map((m) =>
          m.agentSteps?.some((s) => s.status === "running")
            ? { ...m, agentSteps: m.agentSteps.map((s) => (s.status === "running" ? { ...s, status: "failed" as const, endedAt: Date.now() } : s)) }
            : m,
        );
        if (convId) setConversationMessages(convId, next);
        return next;
      });
      setAgentRunId(null);
      setStreamingId(null);
      abortRef.current = null;
    }
  };

  const runImageGen = async (prompt: string) => {
    let convId = activeConversationId;
    if (!convId) convId = newConversation();
    const preset = IMAGE_PRESETS.find((p) => p.id === imgPreset) || IMAGE_PRESETS[0];
    const asstId = uid("a");
    // Check if there's a reference image attached (for image-to-image)
    const refImage = images.length > 0 ? images[0] : "";
    const isImg2Img = !!refImage;
    const newMsgs: ChatMessage[] = [
      ...messages,
      { id: uid("u"), role: "user", content: prompt, images: images.length ? images : undefined, createdAt: Date.now() },
      { id: asstId, role: "assistant", content: "", createdAt: Date.now(), pending: true },
    ];
    setMessages(newMsgs);
    setConversationMessages(convId, newMsgs);
    setLoading(true);
    setImgError("");
    try {
      const res = await generateImage({ prompt, width: preset.w, height: preset.h, model: imgModel, referenceImage: refImage, providers, settings });
      setMessages((prev) => {
        const next = prev.map((m) => (m.id === asstId ? { ...m, pending: false, genImage: { url: res.url, prompt, provider: res.provider, w: res.w, h: res.h, model: res.model, seed: res.seed, isImageToImage: isImg2Img, referenceImage: refImage } } : m));
        if (convId) setConversationMessages(convId, next);
        return next;
      });
    } catch (e: any) {
      const msg = e?.message || String(e);
      setImgError(msg);
      setMessages((prev) => {
        const next = prev.map((m) => (m.id === asstId ? { ...m, pending: false, error: "Image generation failed: " + msg } : m));
        if (convId) setConversationMessages(convId, next);
        return next;
      });
    } finally {
      setLoading(false);
      // Clear the reference image after generation
      setImages([]);
    }
  };

  const reroll = async (msgId: string) => {
    const m = messages.find((x) => x.id === msgId);
    if (!m?.genImage) return;
    setMessages((prev) => prev.map((x) => (x.id === msgId ? { ...x, pending: true, genImage: undefined, error: undefined } : x)));
    setLoading(true);
    try {
      const res = await rerollImage({ prompt: m.genImage.prompt, w: m.genImage.w, h: m.genImage.h, model: m.genImage.model, referenceImage: m.genImage.referenceImage, providers, settings });
      setMessages((prev) => {
        const next = prev.map((x) => (x.id === msgId ? { ...x, pending: false, genImage: { url: res.url, prompt: m.genImage!.prompt, provider: res.provider, w: res.w, h: res.h, model: res.model, seed: res.seed, isImageToImage: m.genImage!.isImageToImage, referenceImage: m.genImage!.referenceImage } } : x));
        if (activeConversationId) setConversationMessages(activeConversationId, next);
        return next;
      });
    } catch (e: any) {
      setMessages((prev) => {
        const next = prev.map((x) => (x.id === msgId ? { ...x, pending: false, error: "Regenerate failed: " + (e?.message || e) } : x));
        if (activeConversationId) setConversationMessages(activeConversationId, next);
        return next;
      });
    } finally {
      setLoading(false);
    }
  };

  const send = async (override?: string) => {
    const content = (override ?? input).trim();
    if ((!content && images.length === 0 && attachments.length === 0) || loading) return;
    if (imgMode) {
      setInput("");
      await runImageGen(content || "abstract math art");
      return;
    }
    const userMsg: ChatMessage = { id: uid("u"), role: "user", content, images: images.length ? images : undefined, attachments: attachments.length ? attachments : undefined, createdAt: Date.now() };
    setInput("");
    setImages([]);
    setAttachments([]);
    await runChat([...messages, userMsg]);
  };

  const editAndResend = async (msgId: string) => {
    const msg = messages.find((m) => m.id === msgId);
    if (!msg || msg.role !== "user") return;
    const content = input.trim();
    if (!content) return;
    const editedMsg: ChatMessage = { ...msg, content, edited: true, createdAt: Date.now() };
    const idx = messages.findIndex((m) => m.id === msgId);
    const truncated = messages.slice(0, idx);
    setInput("");
    setImages([]);
    setAttachments([]);
    setEditingId(null);
    await runChat([...truncated, editedMsg]);
  };

  const startEdit = (msgId: string) => {
    const msg = messages.find((m) => m.id === msgId);
    if (!msg) return;
    setInput(msg.content);
    setImgMode(false);
    setEditingId(msgId);
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const regenerate = async (fromUserMsgId?: string) => {
    if (loading || visible.length === 0) return;
    let userIdx: number;
    if (fromUserMsgId) {
      userIdx = messages.findIndex((m) => m.id === fromUserMsgId);
    } else {
      userIdx = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") { userIdx = i; break; }
      }
    }
    if (userIdx < 0) return;
    const truncated = messages.slice(0, userIdx + 1);
    setMessages(truncated);
    if (activeConversationId) setConversationMessages(activeConversationId, truncated);
    await runChat(truncated);
  };

  const exportConversation = () => {
    const lines: string[] = [
      `# Mathorium Conversation`,
      `Exported: ${new Date().toISOString()}`,
      `Provider: ${activeProvider.name} · ${activeModelId}`,
      "",
      "---",
      "",
    ];
    for (const m of visible) {
      const who = m.role === "user" ? "🧑 User" : "⚛ Assistant";
      const time = new Date(m.createdAt).toLocaleString();
      lines.push(`### ${who}  ·  _${time}_${m.edited ? "  ·  _(edited)_" : ""}`, "");
      if (m.images?.length || m.attachments?.length) {
        const att = [...(m.images || []).map(() => "image"), ...(m.attachments || []).map((a) => a.name)];
        lines.push(`_Attachments: ${att.join(", ")}_`, "");
      }
      lines.push(m.content || "_(empty)_", "", "---", "");
    }
    download(slugify("mathorium-chat") + ".md", lines.join("\n"), "text/markdown");
    pushToast({ title: "Conversation exported", tone: "success" });
  };

  const onFiles = async (files: FileList | File[]) => {
    setBusyAttach(true);
    try {
      for (const f of Array.from(files)) {
        const att: ChatAttachment = { id: uid("att"), name: f.name, type: f.type, size: f.size, kind: "binary" };
        if (f.type.startsWith("image/")) { att.kind = "image"; att.dataUrl = await fileToDataUrl(f); }
        else if (f.type === "application/zip" || f.name.toLowerCase().endsWith(".zip")) {
          att.kind = "zip";
          try {
            const zip = await JSZip.loadAsync(f);
            const list: { name: string; text?: string; note?: string }[] = [];
            const entries = Object.values(zip.files).filter((e: any) => !e.dir);
            for (const entry of entries) {
              const name = (entry as any).name as string;
              if (TEXT_EXT.test(name) && (entry as any)._data?.uncompressedSize < 1_500_000) list.push({ name, text: await (entry as any).async("string") });
              else list.push({ name, note: "binary" });
            }
            att.files = list;
          } catch { att.kind = "binary"; att.note = "zip read failed"; }
        } else if (f.type.startsWith("text/") || TEXT_EXT.test(f.name) || f.type === "application/json") { att.kind = "text"; att.text = await f.text(); }
        setAttachments((prev) => [...prev, att].slice(0, 20));
      }
    } finally { setBusyAttach(false); }
  };

  const pasteImage = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const it of items) if (it.type.startsWith("image/")) { const f = it.getAsFile(); if (f) files.push(f); }
    if (files.length) { e.preventDefault(); onFiles(files); }
  };

  /**
   * The mic button. A blocked browser gets the explanation as a toast rather
   * than a dead button, because "nothing happened" is the failure this whole
   * feature was reported for.
   */
  const toggleVoice = () => {
    if (voice.blocked) {
      pushToast({ title: "Voice input unavailable", description: voice.blocked, tone: "warning" });
      return;
    }
    voice.toggle();
  };

  // Recognition errors are raised asynchronously, long after the click, so they
  // are surfaced from state rather than from the handler that started it.
  useEffect(() => {
    if (voice.error) pushToast({ title: "Voice input", description: voice.error, tone: "error" });
  }, [voice.error, pushToast]);

  // Sending is the end of the sentence: keeping the mic open past it dictates
  // into an empty box the user is no longer looking at.
  useEffect(() => {
    if (loading && voice.listening) voice.stop();
  }, [loading, voice.listening, voice.stop]);

  return (
    <div className="flex h-[calc(100vh-9.5rem)] gap-0">
      <ChatHistorySidebar open={historyOpen} onClose={() => setHistoryOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white md:hidden"
            title="Toggle chat history"
          >
            <IconMenu size={16} />
          </button>
          <Badge tone={imgMode ? "green" : "blue"}>{imgMode ? "Image" : "Chat"}</Badge>
          <span>{imgMode
            ? <>image via <b className="text-slate-300">{imageEngine?.providerName ?? "Pollinations"}</b>{imageEngine?.free ? " · free, no key" : ""}</>
            : <>with <b className="text-slate-300">{activeProvider.name}</b> · {activeModelId}</>}</span>
          {!isVision && !imgMode && <Badge tone="amber">text only</Badge>}
          {/* The token estimate lives in the composer now, next to the input it
              describes, rather than being repeated here. */}
          {agentOn && !imgMode && (
            <span className="hidden items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium text-violet-300 sm:inline-flex" title="Agent Mode is on — replies are planned and self-reviewed">
              <IconAgent size={11} /> agent
            </span>
          )}
          {visible.length > 0 && (
            <div className="ml-auto flex items-center gap-1">
              <Button size="sm" variant="ghost" title="New chat" onClick={() => { newConversation(); setMessages([]); }}>
                <span className="flex items-center gap-1"><IconPlus size={13} /> New</span>
              </Button>
              <Button size="sm" variant="ghost" title="Export conversation to Markdown" onClick={exportConversation}>
                <span className="flex items-center gap-1"><IconDownload size={13} /> .md</span>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { if (confirm("Clear this conversation?")) { setMessages([]); if (activeConversationId) setConversationMessages(activeConversationId, []); } }}>Clear</Button>
            </div>
          )}
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto rounded-2xl border border-white/8 bg-[var(--surface-panel)] p-4">
          {visible.length === 0 && (
            <div className="mx-auto max-w-2xl py-8">
              <div className="text-center">
                {imgMode ? (
                  <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-2xl text-on-accent shadow-lg shadow-indigo-900/40">🎨</div>
                ) : (
                  <MathoriumMark size={56} className="mx-auto mb-3 drop-shadow-xl" title="Mathorium" />
                )}
                <h3 className="text-xl font-semibold text-white">{imgMode ? "Image Generation" : `${APP_NAME} Assistant`}</h3>
                <p className="mt-1.5 text-sm text-slate-500">
                  {imgMode ? "Describe an image and render it. The default engine is free and needs no key; your own providers' image models appear in the picker too." : "Your all-in-one AI for math, code & documents. Solve, explain, transcribe, generate — with beautiful LaTeX & code rendering."}
                </p>
              </div>
              {!imgMode && (
                <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                  {["♾️ Math + LaTeX", "💻 Code", "📄 File & ZIP analysis", "🎨 Image gen", "🔧 Edit & regenerate", "🎙️ Voice input"].map((f) => (
                    <span key={f} className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[10px] text-slate-400">{f}</span>
                  ))}
                </div>
              )}
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {(imgMode ? IMG_SUGGESTIONS : SUGGESTIONS.map((s) => s.text)).map((s, i) => (
                  <button key={i} onClick={() => send(s)} className="group rounded-xl border border-white/10 bg-[var(--surface-card)] p-3 text-left transition hover:border-violet-400/40 hover:bg-violet-500/5">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500 group-hover:text-violet-400">{!imgMode && SUGGESTIONS[i]?.icon ? SUGGESTIONS[i].icon : "→"}</span>
                      <span className="text-[13px] text-slate-200">{s}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {visible.map((m) => {
            const isUser = m.role === "user";
            const hasFiles = (m.attachments && m.attachments.length) || (m.images && m.images.length);
            return (
              <div key={m.id} className={"flex items-start gap-3 " + (isUser ? "flex-row-reverse" : "")}>
                <div className={"mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm shadow " + (isUser ? "bg-gradient-to-br from-violet-500 to-indigo-600 text-on-accent" : m.genImage ? "border border-white/10 bg-[var(--surface-raised)] text-slate-300" : "")}>
                  {/* The assistant wears the app's own mark rather than an emoji:
                      ⚛ drew a different picture on every platform and could not
                      match the header it is meant to echo. */}
                  {isUser ? "🧑" : m.genImage ? "🎨" : <MathoriumMark size={32} />}
                </div>
                <div className={"group min-w-0 max-w-[85%] " + (isUser ? "items-end" : "items-start")}>
                  <div className={"rounded-2xl px-4 py-3 " + (isUser ? "rounded-tr-sm bg-gradient-to-br from-violet-600 to-indigo-600 text-on-accent" : "rounded-tl-sm border border-white/10 bg-[var(--surface-bubble)] text-slate-200")}>
                    {!isUser && m.provider && m.provider !== activeProvider.id && (
                      // Name the model too — "switched to llm7" alone does not tell
                      // the user which of its models actually wrote the answer.
                      <div className="mb-1 text-[10px] text-amber-300/80">↳ auto-switched to {m.provider}{m.model ? ` · ${m.model}` : ""}</div>
                    )}
                    {/* The agent's passes, above the answer they produced — the plan
                        that shaped it, the checks that ran against it, the audit that
                        judged it. Live while being written, collapsed afterwards. */}
                    {!isUser && m.agentSteps?.length ? (
                      <AgentTrace steps={m.agentSteps} live={agentRunId === m.id} />
                    ) : null}
                    {/* The model's own reasoning, which is a different thing from the
                        agent trace above: that is this app's workflow, this is what the
                        model was thinking inside it. Only reasoning models produce any. */}
                    {!isUser && m.reasoning ? (
                      <ThinkingPanel text={m.reasoning} live={streamingId === m.id} />
                    ) : null}
                    {hasFiles ? (
                      <div className="mb-2 space-y-1">
                        {m.images?.map((img, i) => <img key={i} src={img} className="h-24 rounded-lg border border-white/20 object-contain" />)}
                        {m.attachments?.map((a) => (
                          <div key={a.id} className="flex items-center gap-1.5 rounded-lg bg-black/20 px-2 py-1 text-[11px]">
                            <span>{fileIcon(a.kind, a.name)}</span>
                            <span className="truncate">{a.name}</span>
                            <span className="opacity-60">{a.kind === "zip" ? `· ${a.files?.length || 0} files` : a.kind === "text" ? "· text" : `· ${Math.round(a.size / 1024)}KB`}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {m.pending ? (
                      <span className="inline-flex items-center gap-2.5 text-slate-400">
                        <TypingDots />
                        <span className="text-[12px]">{imgMode ? "rendering image…" : "thinking…"}</span>
                      </span>
                    ) : m.error ? (
                      <div className="space-y-1">
                        <div className="text-rose-300">⚠ Request failed</div>
                        <pre className="whitespace-pre-wrap rounded-lg bg-rose-500/10 p-2 text-[11px] text-rose-200">{m.error}</pre>
                      </div>
                    ) : m.genImage ? (
                      <div className="space-y-2">
                        <div className="group/img relative overflow-hidden rounded-xl border border-white/10 bg-black/30">
                          <img
                            src={m.genImage.url}
                            alt={m.genImage.prompt}
                            className="mx-auto max-h-[420px] w-full cursor-zoom-in object-contain transition hover:opacity-90"
                            onClick={() => setFullscreenImg({ url: m.genImage!.url, prompt: m.genImage!.prompt })}
                            title="Click to view fullscreen"
                          />
                          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover/img:bg-black/30 group-hover/img:opacity-100">
                            <span className="flex items-center gap-1.5 rounded-lg bg-black/70 px-3 py-1.5 text-xs text-white"><IconExpand size={14} /> Click to fullscreen</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
                          <Badge tone="green">{m.genImage.provider} · {m.genImage.model}</Badge>
                          {m.genImage.isImageToImage && <Badge tone="blue">img2img</Badge>}
                          <span>{m.genImage.w}×{m.genImage.h}</span>
                          <button onClick={() => reroll(m.id)} className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-slate-300 hover:bg-white/10 hover:text-white"><IconDice size={12} /> regenerate</button>
                          <button onClick={() => setFullscreenImg({ url: m.genImage!.url, prompt: m.genImage!.prompt })} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-sky-300 hover:bg-sky-500/10"><IconExpand size={12} /> fullscreen</button>
                          <button onClick={() => downloadImage(m.genImage!.url, `mathorium-${m.genImage!.seed}.png`)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-emerald-300 hover:bg-emerald-500/10"><IconDownload size={12} /> download</button>
                        </div>
                      </div>
                    ) : isUser ? (
                      <div className="whitespace-pre-wrap break-words text-sm">{m.content}</div>
                    ) : (
                      <MarkdownView text={m.content} streaming={streamingId === m.id} />
                    )}
                  </div>

                  {!m.pending && (
                    <div className={"mt-1 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 " + (isUser ? "justify-end" : "")}>
                      {isUser ? (
                        <>
                          <span className="px-1 text-[9px] text-slate-600">{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{m.edited ? " · edited" : ""}</span>
                          <button onClick={() => copy(m.id, m.content)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/10 hover:text-white">
                            {copiedId === m.id ? <IconCheck size={12} /> : <IconCopy size={12} />}
                            {copiedId === m.id ? "copied" : "copy"}
                          </button>
                          <button onClick={() => startEdit(m.id)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/10 hover:text-white">
                            <IconEdit size={12} /> edit
                          </button>
                        </>
                      ) : !m.error && !m.genImage && m.content ? (
                        <>
                          <button onClick={() => copy(m.id, m.content)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/10 hover:text-white">
                            {copiedId === m.id ? <IconCheck size={12} /> : <IconCopy size={12} />}
                            {copiedId === m.id ? "copied" : "copy md"}
                          </button>
                          <button onClick={() => copy(m.id, markdownToPlainText(m.content))} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/10 hover:text-white">
                            <IconFile size={12} /> text
                          </button>
                          <button onClick={() => regenerate()} disabled={loading} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/10 hover:text-white" title="Regenerate last response">
                            <IconRefresh size={12} /> regenerate
                          </button>
                        </>
                      ) : m.error ? (
                        <button onClick={() => regenerate()} disabled={loading} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-rose-300 hover:bg-rose-500/10">
                          <IconRefresh size={12} /> retry
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        {/* ── Composer ──────────────────────────────────────────────────────
            One panel rather than a stack of them. Everything that used to sit
            above the input as its own bordered box — image-gen controls, the
            continuation notice, errors — is now a strip inside this card, so the
            bottom of the window has a single edge instead of four competing ones.
            The input spans the full width; the tools live under it, where they do
            not shrink the thing the user is actually typing into. */}
        <div
          className={
            "group/composer mt-2 rounded-2xl border bg-gradient-to-b from-[var(--surface-grad)] to-[var(--surface-card)] p-2 transition-colors duration-200 " +
            (loading
              ? "border-violet-400/40 shadow-[0_0_0_1px_rgba(167,139,250,0.12),0_8px_32px_-12px_rgba(76,29,149,0.5)]"
              : "border-white/10 shadow-[0_8px_32px_-16px_rgba(0,0,0,0.8)] focus-within:border-violet-400/40")
          }
        >
          {/* Status strip — only for things the composer is the right place to say.
              Agent progress is deliberately NOT here: it belongs beside the answer
              being produced, and a phase label down here outlives the pass it names.
              What is left is the continuation notice and image errors. */}
          {(continuing > 0 || imgError) && (
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-white/8 bg-black/25 px-2.5 py-1.5 text-[11px]">
              {imgError ? (
                <span className="text-rose-300">⚠ {imgError}</span>
              ) : (
                <>
                  <Spinner className="h-3 w-3 text-violet-300" />
                  <span className="text-violet-200">Hit the length limit — continuing automatically (part {continuing + 1})…</span>
                  <button
                    onClick={() => abortRef.current?.abort()}
                    className="ml-auto rounded px-1.5 py-0.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
                  >
                    stop
                  </button>
                </>
              )}
            </div>
          )}

          {/* Attachments */}
          {(images.length > 0 || attachments.length > 0) && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {images.map((img, i) => (
                <div key={i} className="group/att relative">
                  <img src={img} className="h-12 w-12 rounded-lg border border-white/15 object-cover" />
                  <button
                    onClick={() => setImages((p) => p.filter((_, j) => j !== i))}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-[10px] text-on-accent opacity-0 transition group-hover/att:opacity-100"
                    title="Remove"
                  >
                    <IconClose size={11} />
                  </button>
                </div>
              ))}
              {attachments.map((a) => (
                <div key={a.id} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-slate-200">
                  <span>{fileIcon(a.kind, a.name)}</span>
                  <span className="max-w-28 truncate">{a.name}</span>
                  {a.kind === "zip" && <span className="text-[9px] text-emerald-300">{a.files?.length}f</span>}
                  <button onClick={() => setAttachments((p) => p.filter((x) => x.id !== a.id))} className="ml-0.5 text-slate-500 transition hover:text-rose-300" title="Remove"><IconClose size={11} /></button>
                </div>
              ))}
            </div>
          )}

          {/* Input — full width. Nothing flanks it, so a long formula has the
              whole panel rather than what is left after five icon buttons. */}
          <input ref={imgRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); e.target.value = ""; }} />
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); e.target.value = ""; }} />
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={pasteImage}
            onKeyDown={(e) => {
              // Esc stops a running reply from the keyboard, matching the button's
              // tooltip. Only while loading — otherwise Esc keeps its usual meaning.
              if (e.key === "Escape" && loading) {
                e.preventDefault();
                abortRef.current?.abort();
                return;
              }
              if (e.key === "Enter" && !e.shiftKey && settings.sendOnEnter) {
                e.preventDefault();
                if (loading) return; // a reply is already streaming; Enter must not queue another
                editingId ? editAndResend(editingId) : send();
              }
            }}
            rows={1}
            placeholder={editingId ? "Edit message, then Enter to resend…" : imgMode ? "Describe an image to generate…" : "Ask anything — attach images, files or ZIPs"}
            className="max-h-40 w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed text-slate-100 placeholder:text-slate-600 focus:outline-none"
          />

          {/* Dictation status. Speech recognition is invisible by nature — there
              is no way to tell "not hearing you" from "not running" — so the
              live state is shown explicitly: a pulsing dot while the session is
              open, brighter while sound is actually arriving, and the unconfirmed
              words as they are being revised. */}
          {voice.listening && (
            <div className="mt-1 flex items-start gap-2 rounded-lg bg-rose-500/10 px-2 py-1.5 text-[11px] ring-1 ring-rose-400/20">
              <span className="mt-1 flex h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" style={{ animation: "mfPulse 1.1s ease-in-out infinite" }} />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-rose-300">{voice.hearing ? "Listening…" : "Waiting for speech…"}</span>
                {voice.interim && <span className="text-slate-400"> {voice.interim}</span>}
                {!voice.interim && !voice.hearing && <span className="text-slate-500"> speak now, or press the stop button to finish</span>}
              </span>
              <style>{`@keyframes mfPulse{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:scale(1.15)}}`}</style>
            </div>
          )}

          {/* Tool rail — the controls sit below the text, sized down to icon
              chips so the row reads as one strip rather than a button bar.

              Everything that decides *what goes into the message* — an image, a file,
              or a generated picture — is behind the one `+`. Three unlabelled glyphs
              in a row made the user hover each to find out which was which, and it
              only gets worse as more are added; a labelled list scales. Voice stays
              outside it, because dictation is how you fill the box rather than
              something you attach to it, and it needs to be one press away. */}
          <div className="mt-1 flex items-center gap-1">
            <button
              ref={setPlusEl}
              type="button"
              title="Attach or generate"
              onClick={() => setPlusOpen((v) => !v)}
              className={
                "flex h-7 w-7 items-center justify-center rounded-lg transition " +
                (plusOpen ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/8 hover:text-white")
              }
            >
              {busyAttach ? <Spinner className="h-4 w-4" /> : <IconPlus size={17} className={plusOpen ? "rotate-45 transition-transform" : "transition-transform"} />}
            </button>
            <Popover anchor={plusEl} open={plusOpen} className="w-60 py-1">
              <MenuItem
                icon={<IconImage size={16} />}
                label={imgMode ? "Reference image" : "Upload image"}
                hint={imgMode ? "Use as the basis for image-to-image" : isVision ? "Let the model see a picture" : "This model cannot read images"}
                disabled={loading || (!imgMode && !isVision)}
                onClick={() => { setPlusOpen(false); imgRef.current?.click(); }}
              />
              <MenuItem
                icon={<IconPaperclip size={16} />}
                label="Attach files"
                hint="Code, text, PDF-free ZIPs — read into context"
                disabled={loading || busyAttach || imgMode}
                onClick={() => { setPlusOpen(false); fileRef.current?.click(); }}
              />
              <div className="my-1 h-px bg-white/8" />
              <MenuItem
                icon={<IconSparkles size={16} />}
                label="Generate an image"
                hint="Free, no key — or use your provider's engine"
                active={imgMode}
                onClick={() => { setPlusOpen(false); setImgMode((v) => !v); setEditingId(null); }}
              />
            </Popover>

            {!imgMode && (
              <>
                <ToolChip
                  active={voice.listening}
                  tone="danger"
                  title={
                    voice.blocked
                      ? `Voice input unavailable — ${voice.blocked}`
                      : voice.listening
                        ? "Stop dictation"
                        : `Dictate your message (${VOICE_LANGS.find((l) => l.id === voice.lang)?.label ?? voice.lang})`
                  }
                  onClick={toggleVoice}
                >
                  {voice.listening ? <IconStop size={14} /> : <IconMic size={16} className={voice.blocked ? "opacity-40" : ""} />}
                </ToolChip>
                {/* The language is the single most common reason dictation
                    "does not work", so it is one click from the mic instead of
                    buried in Settings. */}
                <button
                  ref={setVoiceLangEl}
                  type="button"
                  onClick={() => setVoiceLangOpen((v) => !v)}
                  title="Dictation language"
                  className={
                    "h-7 rounded-lg px-1.5 text-[10px] font-semibold uppercase tracking-wide transition " +
                    (voice.listening ? "text-rose-300 hover:bg-white/8" : "text-slate-500 hover:bg-white/8 hover:text-slate-300")
                  }
                >
                  {voice.lang.split("-")[0]}
                </button>
                <Popover anchor={voiceLangEl} open={voiceLangOpen} className="max-h-72 w-48 overflow-y-auto py-1">
                  {VOICE_LANGS.map((l) => (
                    <MenuItem
                      key={l.id}
                      label={l.label}
                      hint={l.id}
                      active={voice.lang === l.id}
                      onClick={() => { voice.setLang(l.id); setVoiceLangOpen(false); }}
                    />
                  ))}
                </Popover>
              </>
            )}

            {imgMode && (
              // Image mode changes what Send does, so it says so on the rail rather
              // than only in the header — and carries its own way out.
              <button
                onClick={() => setImgMode(false)}
                title="Back to chat"
                className="flex h-7 items-center gap-1.5 rounded-lg bg-emerald-500/15 px-2 text-[11px] font-medium text-emerald-200 ring-1 ring-emerald-400/25 transition hover:bg-emerald-500/25"
              >
                <IconSparkles size={13} />
                Image
                <IconClose size={12} className="opacity-60" />
              </button>
            )}

            <div className="mx-1 h-4 w-px bg-white/10" />

            {imgMode ? (
              <>
                {/* Grouped by supplier, because the list is now two keyless
                    built-ins plus whatever the user's own providers reported.
                    An engine whose provider has no key stays visible but
                    disabled — a shorter list than the provider's docs promise
                    reads as the app not supporting it. */}
                <Select
                  value={imageEngine?.id ?? "sana"}
                  onChange={(e) => setImgModel(e.target.value)}
                  title={imageEngine?.note || "Which engine draws the picture"}
                  className="h-7 w-auto max-w-[15rem] border-white/10 bg-black/30 py-0 text-[11px]"
                >
                  {[...new Set(imageEngines.map((e) => e.providerName))].map((group) => (
                    <optgroup key={group} label={group}>
                      {imageEngines
                        .filter((e) => e.providerName === group)
                        .map((e) => (
                          <option key={e.id} value={e.id} disabled={!e.ready}>
                            {e.label}
                            {e.ready ? "" : " — needs API key"}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </Select>
                <Select value={imgPreset} onChange={(e) => setImgPreset(e.target.value)} className="h-7 w-auto border-white/10 bg-black/30 py-0 text-[11px]">
                  {IMAGE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </Select>
                {images.length > 0 && (
                  imageEngine?.supportsImg2Img
                    ? <Badge tone="blue">img2img</Badge>
                    // Silently ignoring the attachment would look like a bug in
                    // the reference image, not a limit of the chosen engine.
                    : <Badge tone="amber" >{imageEngine?.providerName ?? "This engine"} ignores the reference</Badge>
                )}
                {/* Perchance cannot be an engine — no CORS, a Cloudflare-gated
                    key, and no framing. See lib/imageGen. A hand-off is the
                    honest version of "supported". */}
                <button
                  type="button"
                  onClick={async () => {
                    const prompt = input.trim() || "a beautiful abstract math fractal";
                    const { copied } = await perchanceHandoff(prompt);
                    pushToast({
                      title: "Opened Perchance",
                      description: copied
                        ? "Your prompt is on the clipboard — paste it into the box and press Generate. Perchance is free and unlimited, but blocks other sites from calling it, so it cannot run inside this app."
                        : `Clipboard access was refused, so copy your prompt across by hand. ${PERCHANCE_URL}`,
                      tone: copied ? "info" : "warning",
                    });
                  }}
                  title="Perchance is free and unlimited but cannot be embedded — this opens it in a tab with your prompt copied."
                  className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-slate-500 transition hover:bg-white/5 hover:text-slate-300"
                >
                  <IconExpand size={12} />
                  Perchance
                </button>
              </>
            ) : (
              <>
                {/* Agent Mode lives here rather than buried in Settings: it changes
                    what every send does, and how long it takes, so it belongs
                    where the sending happens. */}
                <button
                  onClick={() => updateSettings({ agentMode: !agentOn })}
                  title={
                    agentOn
                      ? "Agent Mode is on — every reply is planned, then audited and corrected before you see it. Click to switch to a single fast pass."
                      : "Agent Mode is off — replies are a single pass. Click to enable planning and self-review."
                  }
                  className={
                    "flex h-7 items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium transition " +
                    (agentOn
                      ? "bg-gradient-to-r from-violet-500/25 to-indigo-500/25 text-violet-200 ring-1 ring-violet-400/30"
                      : "text-slate-500 hover:bg-white/5 hover:text-slate-300")
                  }
                >
                  <IconAgent size={14} className={agentOn ? "" : "opacity-60"} />
                  Agent
                </button>
                {agentOn && (
                  <Select
                    value={settings.agentDepth ?? "balanced"}
                    onChange={(e) => updateSettings({ agentDepth: e.target.value as "quick" | "balanced" | "thorough" })}
                    title="How many extra passes each reply gets"
                    className="h-7 w-auto border-white/10 bg-black/30 py-0 text-[11px]"
                  >
                    <option value="quick">Quick</option>
                    <option value="balanced">Balanced</option>
                    <option value="thorough">Thorough</option>
                  </Select>
                )}
              </>
            )}

            <div className="ml-auto flex items-center gap-2">
              {settings.showTokenCount && !imgMode && (
                <span className="hidden font-mono text-[10px] text-slate-600 sm:inline" title="Estimated context tokens">
                  {formatTokenCount(inputTokens)}
                </span>
              )}
              <span className="hidden text-[10px] text-slate-600 lg:inline">
                {settings.sendOnEnter ? "Enter ↵ send · Shift+Enter newline" : "Ctrl+Enter to send"}
              </span>
              {/* While a reply is generating the primary button *becomes* Stop, rather
                  than greying out next to a separate stop control. Stopping is the only
                  thing worth doing at that moment, so it gets the button the user's
                  pointer is already on — and one click ends the reply immediately. */}
              {loading ? (
                <Button variant="danger" size="sm" title="Stop generating (Esc)" onClick={() => abortRef.current?.abort()}>
                  <span className="flex items-center gap-1.5"><IconStop size={13} /> Stop</span>
                </Button>
              ) : editingId ? (
                <Button variant="success" size="sm" onClick={() => editAndResend(editingId)}>
                  <span className="flex items-center gap-1.5"><IconRefresh size={14} /> Resend</span>
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!input.trim() && images.length === 0 && attachments.length === 0}
                  onClick={() => send()}
                >
                  <span className="flex items-center gap-1.5">
                    {imgMode ? <IconSparkles size={14} /> : <IconSend size={14} />}
                    {imgMode ? "Render" : "Send"}
                  </span>
                </Button>
              )}
            </div>
          </div>

          {editingId && (
            <div className="mt-1.5 flex items-center gap-2 border-t border-white/8 px-1 pt-1.5 text-[11px] text-amber-300">
              <span>Editing an earlier message — sending replaces the conversation below it.</span>
              <button onClick={() => { setEditingId(null); setInput(""); }} className="text-slate-500 transition hover:text-white">cancel</button>
            </div>
          )}
        </div>
      </div>

      {/* Fullscreen image viewer */}
      {fullscreenImg && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 p-4 animate-[fadeIn_.15s_ease]"
          onClick={() => setFullscreenImg(null)}
        >
          <button
            onClick={() => setFullscreenImg(null)}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            title="Close (Esc)"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
          <div className="flex max-h-full max-w-full flex-col items-center" onClick={(e) => e.stopPropagation()}>
            <img
              src={fullscreenImg.url}
              alt={fullscreenImg.prompt}
              className="max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl"
            />
            <div className="mt-3 max-w-2xl text-center">
              <p className="text-sm text-slate-300">{fullscreenImg.prompt}</p>
              <div className="mt-2 flex justify-center gap-2">
                <button
                  onClick={() => downloadImage(fullscreenImg.url, "mathorium-fullscreen.png")}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/30"
                >
                  <IconDownload size={14} /> Download
                </button>
                <button
                  onClick={() => { window.open(fullscreenImg.url, "_blank"); }}
                  className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20"
                >
                  ↗ Open original
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
