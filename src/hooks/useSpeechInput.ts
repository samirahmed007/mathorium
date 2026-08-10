import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Dictation for a text box, on top of the Web Speech API.
 *
 * The API is deceptively simple and every naive use of it is wrong in the same
 * three ways. This hook exists to get those three right once.
 *
 * 1. Interim results are a *live redraft*, not new text. Each `result` event
 *    re-sends the current guess in full — "hel", "hello", "hello wor",
 *    "hello world" — so appending what arrives multiplies every word
 *    ("hellohello worhello world"). The fix is to treat the box as a rendering
 *    of `base + committed + interim` and rewrite it, never to append.
 *
 * 2. `continuous = true` does not mean continuous. Chrome ends the session
 *    after a few seconds of silence and fires `end`; a hook that just flips its
 *    flag off there dies mid-sentence while the user is still talking. So a
 *    session that ended without being asked to is restarted, keeping the text
 *    committed so far.
 *
 * 3. It needs a secure page and a network. Chrome streams the audio to a Google
 *    service, so recognition fails on `file://` and fails offline — both of
 *    which this app supports for everything else. Those are reported as what
 *    they are instead of a bare "network" error code.
 */

/** What the recogniser hands back; typed loosely because it is not in lib.dom. */
type SR = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
};

const getCtor = (): (new () => SR) | null =>
  (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;

/**
 * Why dictation cannot run here, or null if it can.
 *
 * Checked up front so the mic button can be disabled with a reason, rather than
 * looking live and then failing with an error code the moment it is pressed.
 */
function unavailable(): string | null {
  if (!getCtor()) {
    return "This browser has no speech recognition. Chrome, Edge and Safari have it; Firefox does not.";
  }
  if (!window.isSecureContext) {
    return `Speech recognition needs a secure page. This one is ${location.protocol || "file:"} — serve the app over https:// or from localhost and the mic will work.`;
  }
  return null;
}

/** Join two transcript fragments without doubling or eating a space. */
function join(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  if (/\s$/.test(a) || /^[\s,.;:!?)\]}]/.test(b)) return a + b;
  return a + " " + b;
}

const LANG_KEY = "mf-voice-lang";

/**
 * Languages offered in the picker. Chrome accepts any BCP-47 tag, so this is a
 * shortlist of the common ones rather than a limit — recognition quality is the
 * service's business, and a wrong language is the single most common reason
 * dictation "does not work".
 */
export const VOICE_LANGS: { id: string; label: string }[] = [
  { id: "en-US", label: "English (US)" },
  { id: "en-GB", label: "English (UK)" },
  { id: "en-IN", label: "English (India)" },
  { id: "hi-IN", label: "हिन्दी" },
  { id: "bn-IN", label: "বাংলা" },
  { id: "es-ES", label: "Español" },
  { id: "fr-FR", label: "Français" },
  { id: "de-DE", label: "Deutsch" },
  { id: "pt-BR", label: "Português (BR)" },
  { id: "it-IT", label: "Italiano" },
  { id: "ru-RU", label: "Русский" },
  { id: "ar-SA", label: "العربية" },
  { id: "zh-CN", label: "中文 (简体)" },
  { id: "ja-JP", label: "日本語" },
  { id: "ko-KR", label: "한국어" },
];

/** Pick a sensible default: the browser's language if it is one we list. */
function defaultLang(): string {
  const stored = localStorage.getItem(LANG_KEY);
  if (stored) return stored;
  const nav = navigator.language || "en-US";
  if (VOICE_LANGS.some((l) => l.id === nav)) return nav;
  const base = nav.split("-")[0];
  return VOICE_LANGS.find((l) => l.id.startsWith(base + "-"))?.id ?? "en-US";
}

export type SpeechState = {
  /** Dictation is running (or restarting itself between phrases). */
  listening: boolean;
  /** The current unconfirmed guess, for a live preview under the box. */
  interim: string;
  /** True between `speechstart` and `speechend` — proof the mic hears something. */
  hearing: boolean;
  /** Human-readable reason dictation is impossible here, or null. */
  blocked: string | null;
  /** Last failure, cleared when dictation next starts. */
  error: string;
  lang: string;
  setLang: (l: string) => void;
  start: () => void;
  stop: () => void;
  toggle: () => void;
};

/**
 * @param value   the current text of the box being dictated into
 * @param onText  called with the full new text whenever the transcript changes
 */
export function useSpeechInput({
  value,
  onText,
  maxLength = 4000,
}: {
  value: string;
  onText: (next: string) => void;
  maxLength?: number;
}): SpeechState {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [hearing, setHearing] = useState(false);
  const [error, setError] = useState("");
  const [lang, setLangState] = useState(defaultLang);
  const [blocked] = useState<string | null>(unavailable);

  const recRef = useRef<SR | null>(null);
  /** The box's text at the moment dictation started — never rewritten. */
  const baseRef = useRef("");
  /** Everything the recogniser has finalised in this session. */
  const finalRef = useRef("");
  /** Set while the user is deliberately stopping, so `end` does not restart. */
  const stoppingRef = useRef(false);
  /** Consecutive silent restarts, to stop an empty session looping forever. */
  const emptyRunsRef = useRef(0);
  /** The last text this hook wrote, and the interim tail inside it — used to
   *  notice that the *user* changed the box while dictation was running. */
  const emittedRef = useRef("");
  const interimRef = useRef("");
  /** Bumped for every session, so a stopped one's late events can be ignored. */
  const sessionRef = useRef(0);
  const langRef = useRef(lang);
  langRef.current = lang;
  // The callback and the current text are read at event time, not captured:
  // recognition outlives many renders.
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const valueRef = useRef(value);
  valueRef.current = value;

  const setLang = useCallback((l: string) => {
    setLangState(l);
    try { localStorage.setItem(LANG_KEY, l); } catch { /* private mode */ }
    // A language change mid-session only takes effect on the next start, so the
    // running session is cycled to make the choice immediate.
    const rec = recRef.current;
    if (rec) { stoppingRef.current = false; rec.stop(); }
  }, []);

  /** Push `base + final + interim` into the box. */
  const render = useCallback((live: string) => {
    // Dictation is not exclusive: the user can keep typing, delete a word, or
    // send the message (which empties the box) while the mic is open. Any of
    // those makes the box differ from what was last written here, and blindly
    // re-rendering `base + transcript` would throw their edit away. Adopt it as
    // the new base instead — minus the interim tail, which is unconfirmed text
    // this hook is about to re-send anyway.
    if (valueRef.current !== emittedRef.current) {
      const tail = interimRef.current;
      const cur = valueRef.current;
      baseRef.current = tail && cur.endsWith(tail) ? cur.slice(0, cur.length - tail.length).replace(/\s+$/, "") : cur;
      finalRef.current = "";
    }
    const next = join(join(baseRef.current, finalRef.current), live).slice(0, maxLength);
    interimRef.current = live;
    emittedRef.current = next;
    onTextRef.current(next);
  }, [maxLength]);

  const build = useCallback((id: number): SR | null => {
    const Ctor = getCtor();
    if (!Ctor) return null;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = langRef.current;

    /**
     * A recogniser does not die when it is told to stop — `end` arrives later,
     * and by then the user may already have started a new session (or changed
     * language, which restarts one). Every handler therefore checks that it
     * still belongs to the current session; without this, a stopped session's
     * `end` restarts itself and leaves a zombie recogniser holding the
     * microphone that nothing can turn off.
     */
    const stale = () => id !== sessionRef.current;

    rec.onresult = (e: any) => {
      if (stale()) return;
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = (r[0]?.transcript ?? "").trim();
        if (!text) continue;
        if (r.isFinal) finalRef.current = join(finalRef.current, text);
        else live = join(live, text);
      }
      emptyRunsRef.current = 0;
      setInterim(live);
      render(live);
    };

    rec.onspeechstart = () => !stale() && setHearing(true);
    rec.onspeechend = () => !stale() && setHearing(false);

    rec.onerror = (e: any) => {
      if (stale()) return;
      const code = e?.error || "unknown";
      // `no-speech` and `aborted` are normal punctuation in a dictation session,
      // not failures: Chrome raises them whenever a phrase ends in silence or a
      // restart overlaps. Surfacing them would make the UI blink red constantly.
      if (code === "no-speech" || code === "aborted") return;
      stoppingRef.current = true;
      setError(
        code === "not-allowed" || code === "service-not-allowed"
          ? "Microphone blocked. Click the mic/lock icon in the address bar, allow the microphone for this site, and try again."
          : code === "audio-capture"
            ? "No microphone found. Plug one in (or pick one in the OS sound settings) and try again."
            : code === "network"
              ? "Speech recognition needs the internet — Chrome sends the audio to Google's service to transcribe it. Everything else in this app still works offline."
              : code === "language-not-supported"
                ? `Speech recognition has no model for ${langRef.current}. Pick another language.`
                : `Voice input failed: ${code}`,
      );
    };

    rec.onend = () => {
      if (stale()) return;
      setHearing(false);
      setInterim("");
      // Chrome ends a session after a short silence even with continuous = true.
      // If the user has not asked to stop, that is a pause in dictation, not the
      // end of it — pick straight back up. This is also the path a language
      // change takes, which is why the tag is re-read here.
      const finish = () => {
        sessionRef.current++;
        recRef.current = null;
        setListening(false);
      };
      if (stoppingRef.current) return finish();
      // Six silent sessions in a row: the mic is on but nothing is being said.
      // Keeping it open would leave the browser's recording indicator lit for no
      // reason.
      if (++emptyRunsRef.current > 6) return finish();
      try {
        rec.lang = langRef.current;
        rec.start();
      } catch {
        finish();
      }
    };

    return rec;
  }, [render]);

  const start = useCallback(() => {
    if (recRef.current || blocked) return;
    const id = ++sessionRef.current;
    const rec = build(id);
    if (!rec) return;
    setError("");
    setInterim("");
    stoppingRef.current = false;
    emptyRunsRef.current = 0;
    finalRef.current = "";
    // Dictation adds to whatever is already typed rather than replacing it.
    baseRef.current = valueRef.current;
    emittedRef.current = valueRef.current;
    interimRef.current = "";
    try {
      rec.start();
      recRef.current = rec;
      setListening(true);
    } catch (e: unknown) {
      setError(`Could not start the microphone: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [blocked, build]);

  const stop = useCallback(() => {
    stoppingRef.current = true;
    setInterim("");
    const rec = recRef.current;
    // Released here rather than in `end`, so pressing the mic again works at
    // once instead of after the recogniser gets round to shutting down.
    recRef.current = null;
    setListening(false);
    if (!rec) return;
    // `stop()` still delivers the phrase in progress; `abort()` would throw it
    // away. The last words someone said are exactly the ones they want kept.
    try { rec.stop(); } catch { /* already stopped */ }
  }, []);

  const toggle = useCallback(() => (recRef.current ? stop() : start()), [start, stop]);

  // Leaving the page or the tab must release the microphone. Without this the
  // browser's "recording" indicator stays lit after the user has moved on.
  useEffect(() => {
    return () => {
      stoppingRef.current = true;
      sessionRef.current++;
      // `abort()` rather than `stop()`: there is no box left to deliver a final
      // phrase into, and abort releases the microphone immediately.
      try { recRef.current?.abort(); } catch { /* nothing to abort */ }
      recRef.current = null;
    };
  }, []);

  return { listening, interim, hearing, blocked, error, lang, setLang, start, stop, toggle };
}
