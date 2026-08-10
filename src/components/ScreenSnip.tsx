import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./ui";
import { clamp } from "@/lib/utils";

/**
 * Screen snip — capture maths from anywhere on the machine, not just from files.
 *
 * The problem this solves: the maths people want to convert is usually on screen
 * already — a PDF in another window, a lecture video, a paywalled textbook
 * viewer, a Teams call — and the only way to get it into the app was to take an
 * OS screenshot by hand, save it, then drag the file in.
 *
 * The whole flow is one screen share:
 *
 *   · the browser's own picker chooses the screen or window, once. The stream
 *     stays live, so any number of snips follow without re-authorising;
 *   · a countdown before the frame is grabbed, because the user has to *leave*
 *     this window to reach what they want to capture. A keyboard shortcut cannot
 *     do that job — key events stop arriving the moment focus goes elsewhere,
 *     which is exactly when the shot is needed. The countdown is mirrored into
 *     document.title so it stays readable from the taskbar, and a short beep
 *     marks the actual capture for when nothing of ours is visible at all;
 *   · repeat shots for multi-page work — arm it, then page through a PDF while
 *     it fires;
 *   · a crop step per frame. Not optional polish: the offline Pix2Text engine is
 *     a formula recogniser and reads a single cropped expression far better than
 *     a full 4K desktop, and cloud vision models pay per pixel of an image that
 *     is mostly window chrome. Several crops can be taken from one frame.
 *
 * Sharing is the user's to end at any time (Stop sharing), ends itself when the
 * browser's own "stop sharing" bar is used, optionally ends after each capture,
 * and always ends when this panel unmounts — the stream never outlives the tab
 * that opened it.
 */

type Frame = {
  /** Object URL, not a data URL: a 4K PNG is ~6 MB, and repeat shots would put
   *  tens of MB of base64 into React state. Revoked when the cropper closes. */
  url: string;
  w: number;
  h: number;
  shot: number;
};

type Sel = { x: number; y: number; w: number; h: number };

const DELAYS = [0, 3, 5, 10];

/** Pix2Text and cloud OCR both degrade on a small, low-resolution crop. A tight
 *  selection around one formula is often only ~300px wide, so it is scaled up
 *  (smoothly, from the original pixels) toward this before being queued. */
const MIN_LONG_EDGE = 760;

function canvasToBlob(c: HTMLCanvasElement, type = "image/png"): Promise<Blob | null> {
  return new Promise((res) => c.toBlob(res, type));
}

function stamp(n: number): string {
  const d = new Date();
  const p = (v: number) => String(v).padStart(2, "0");
  return `snip-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${n}.png`;
}

export function ScreenSnip({ onImages }: { onImages: (files: File[]) => void }) {
  const [sharing, setSharing] = useState(false);
  const [surface, setSurface] = useState("");
  const [error, setError] = useState("");
  const [delay, setDelay] = useState(5);
  const [shots, setShots] = useState(1);
  const [keepAlive, setKeepAlive] = useState(true);
  const [sound, setSound] = useState(true);
  const [countdown, setCountdown] = useState<{ left: number; shot: number; of: number } | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [added, setAdded] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const stopShare = useCallback(() => {
    cancelRef.current = true;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setSharing(false);
    setSurface("");
    setCountdown(null);
  }, []);

  // The stream must not outlive this panel: a live display capture keeps the
  // browser's "sharing your screen" indicator up, and leaving that behind after
  // the user has navigated away reads as spyware.
  useEffect(() => stopShare, [stopShare]);

  /**
   * The countdown has to be legible from outside the app, because by design the
   * user is looking at something else while it runs. The tab title is the one
   * surface still visible from the taskbar and the browser tab strip.
   */
  useEffect(() => {
    if (!countdown) return;
    const original = document.title;
    document.title = `⏱ ${countdown.left}s → snip${countdown.of > 1 ? ` ${countdown.shot}/${countdown.of}` : ""}`;
    return () => { document.title = original; };
  }, [countdown]);

  const beep = useCallback(() => {
    if (!soundRef.current) return;
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ac = (audioRef.current ??= new Ctor());
      void ac.resume();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.frequency.value = 920;
      gain.gain.setValueAtTime(0.0001, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.09, ac.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.12);
      osc.connect(gain).connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + 0.13);
    } catch {
      /* audio is a courtesy, never a requirement */
    }
  }, []);

  const ensureStream = useCallback(async (): Promise<MediaStream | null> => {
    if (streamRef.current) return streamRef.current;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("This browser cannot capture the screen. Chrome, Edge, Firefox and Safari 13+ support it; the page must also be served over https:// or file:// (not plain http:// on a remote host).");
      return null;
    }
    setError("");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        // Ask for the full native resolution: the point of a snip is to read
        // small type, and a downscaled 1280px capture of a 4K desktop is
        // illegible to any OCR engine. Frame rate is pushed *down* instead —
        // stills are all that is needed, and a low rate keeps the encoder cheap.
        video: { frameRate: { ideal: 8, max: 15 }, width: { ideal: 3840 }, height: { ideal: 2160 }, displaySurface: "monitor" },
        audio: false,
        // Keep this tab out of the picker: capturing ourselves is a hall of
        // mirrors, and it is never what someone snipping maths wants.
        selfBrowserSurface: "exclude",
        // Lets the user swap to a different window mid-share from the browser's
        // own bar, without coming back here to re-authorise.
        surfaceSwitching: "include",
        monitorTypeSurfaces: "include",
      } as DisplayMediaStreamOptions);

      const track = stream.getVideoTracks()[0];
      // The browser's own "Stop sharing" bar, or closing the shared window, ends
      // the track without telling us any other way.
      track.addEventListener("ended", () => stopShare());
      const kind = (track.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface;
      setSurface(kind === "monitor" ? "Entire screen" : kind === "window" ? "Application window" : kind === "browser" ? "Browser tab" : track.label || "Screen");

      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => {});
        // A frame can only be grabbed once the first one has actually decoded.
        for (let i = 0; i < 60 && !v.videoWidth; i++) await new Promise((r) => setTimeout(r, 50));
      }
      setSharing(true);
      return stream;
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      setError(
        err?.name === "NotAllowedError"
          ? "Screen capture was cancelled (or blocked by browser permissions)."
          : `Could not start screen capture: ${err?.message || String(e)}`,
      );
      return null;
    }
  }, [stopShare]);

  const grab = useCallback(async (shot: number): Promise<Frame | null> => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0);
    const blob = await canvasToBlob(c);
    if (!blob) return null;
    return { url: URL.createObjectURL(blob), w: c.width, h: c.height, shot };
  }, []);

  const wait = useCallback((sec: number, shot: number, of: number) => {
    return new Promise<void>((resolve) => {
      if (sec <= 0) return resolve();
      // Deadline rather than tick-counting: a background tab throttles timers to
      // roughly 1/second, so counting ticks would drift badly exactly when the
      // user is away — which is every timed capture.
      const end = Date.now() + sec * 1000;
      setCountdown({ left: sec, shot, of });
      const done = () => {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        setCountdown(null);
        resolve();
      };
      timerRef.current = window.setInterval(() => {
        if (cancelRef.current) return done();
        const left = Math.ceil((end - Date.now()) / 1000);
        if (left <= 0) return done();
        setCountdown({ left, shot, of });
      }, 200);
    });
  }, []);

  const capture = useCallback(
    async (delaySec: number, count: number) => {
      const stream = await ensureStream();
      if (!stream) return;
      cancelRef.current = false;
      // Created inside the click that started this, so the autoplay policy lets
      // it make sound later, when the tab may no longer be focused.
      if (sound && !audioRef.current) {
        try {
          const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          audioRef.current = new Ctor();
        } catch { /* no audio available */ }
      }

      const taken: Frame[] = [];
      for (let i = 0; i < count; i++) {
        await wait(i === 0 ? delaySec : Math.max(delaySec, 2), i + 1, count);
        if (cancelRef.current || !streamRef.current) break;
        const f = await grab(i + 1);
        if (f) { taken.push(f); beep(); }
      }
      if (!keepAlive) stopShare();
      if (taken.length) setFrames(taken);
      else if (!cancelRef.current) setError("The capture produced no frame — the shared surface may have been closed.");
    },
    [ensureStream, wait, grab, beep, keepAlive, stopShare, sound],
  );

  // Snap without leaving the app. Only bound while a share is live, so it never
  // shadows a browser shortcut for someone who is not using this panel.
  useEffect(() => {
    if (!sharing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "S" || e.key === "s")) {
        e.preventDefault();
        capture(0, 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sharing, capture]);

  const closeCropper = useCallback(() => {
    setFrames((prev) => { prev.forEach((f) => URL.revokeObjectURL(f.url)); return []; });
  }, []);

  const acceptCrop = useCallback(
    (file: File) => {
      onImages([file]);
      setAdded((n) => n + 1);
    },
    [onImages],
  );

  return (
    <div className="rounded-2xl border border-white/8 bg-[var(--surface-card)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/20 to-violet-500/20 text-lg">📸</div>
        <div className="mr-auto min-w-[190px]">
          <div className="text-sm font-semibold text-white">Screen snip</div>
          <div className="text-[11px] text-slate-500">
            {sharing
              ? `Sharing ${surface} · snip as many times as you like · Ctrl+Shift+S`
              : "Capture maths straight off your screen — PDFs, videos, other apps. No file needed."}
          </div>
        </div>

        {/* The live surface, at thumbnail size. It is the same <video> the frames
            are drawn from, kept on screen rather than hidden: a display:none
            video is not guaranteed to keep decoding, and drawing one to a canvas
            can hand back a blank frame. It doubles as the confirmation that the
            right window is being shared. */}
        <video
          ref={videoRef}
          muted
          playsInline
          className={
            sharing
              ? "h-12 w-[86px] rounded-lg border border-white/10 bg-black object-cover"
              : "pointer-events-none absolute h-px w-px opacity-0"
          }
        />

        {!sharing ? (
          <Button variant="primary" size="sm" onClick={() => capture(delay, shots)}>
            🖥 Start screen capture
          </Button>
        ) : (
          <>
            <Button variant="primary" size="sm" onClick={() => capture(0, 1)} disabled={!!countdown}>
              📸 Snap now
            </Button>
            <Button variant="subtle" size="sm" onClick={() => capture(delay, shots)} disabled={!!countdown}>
              ⏱ Snap in {delay}s{shots > 1 ? ` ×${shots}` : ""}
            </Button>
            <Button variant="danger" size="sm" onClick={stopShare}>■ Stop sharing</Button>
          </>
        )}
      </div>

      {/* options */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/8 pt-2.5 text-[11px] text-slate-400">
        <div className="flex items-center gap-1.5">
          <span>Delay</span>
          <div className="flex items-center gap-1 rounded-lg bg-black/30 p-0.5">
            {DELAYS.map((d) => (
              <button
                key={d}
                onClick={() => setDelay(d)}
                title={d === 0 ? "Capture immediately" : `Wait ${d}s — enough to switch to another window before the frame is taken`}
                className={
                  "rounded-md px-2 py-0.5 font-medium transition " +
                  (delay === d ? "bg-gradient-to-br from-violet-500 to-indigo-600 text-on-accent" : "text-slate-400 hover:text-white")
                }
              >
                {d === 0 ? "none" : `${d}s`}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-1.5" title="Take several frames in a row, spaced by the delay — arm it, then page through a PDF while it fires.">
          <span>Repeat</span>
          <input
            type="number"
            min={1}
            max={10}
            value={shots}
            onChange={(e) => setShots(clamp(Number(e.target.value) || 1, 1, 10))}
            className="w-12 rounded-md border border-white/10 bg-[var(--surface-well)] px-1 py-0.5 text-center text-slate-200"
          />
          <span>{shots > 1 ? "frames" : "frame"}</span>
        </label>

        <button
          onClick={() => setKeepAlive((v) => !v)}
          aria-pressed={keepAlive}
          title={keepAlive ? "Sharing stays live after a snip, so the next one needs no permission prompt. Click to stop it automatically instead." : "Sharing stops the moment a capture finishes. Click to keep it live for repeat snips."}
          className={
            "rounded-lg border px-2 py-1 transition-colors " +
            (keepAlive ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20" : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10")
          }
        >
          {keepAlive ? "🔗 Keep sharing after snip" : "⏏ Auto-stop after snip"}
        </button>

        <button
          onClick={() => setSound((v) => !v)}
          aria-pressed={sound}
          title="A short beep marks the moment the frame is taken — the only cue available when you are looking at another window."
          className={
            "rounded-lg border px-2 py-1 transition-colors " +
            (sound ? "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10" : "border-white/10 bg-white/5 text-slate-500 hover:bg-white/10")
          }
        >
          {sound ? "🔔 Beep on capture" : "🔕 Silent"}
        </button>

        {added > 0 && <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-300">{added} snip{added > 1 ? "s" : ""} queued</span>}
      </div>

      {error && (
        <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">{error}</div>
      )}

      {/* Armed. Shown in-app for the case where the user never leaves; the title
          bar and the beep cover the case where they do. */}
      {countdown && (
        <div className="mt-2 flex items-center gap-3 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2">
          <div className="text-2xl font-bold tabular-nums text-violet-300">{countdown.left}</div>
          <div className="mr-auto text-[11px] text-slate-300">
            Switch to whatever you want to capture — the frame is taken automatically
            {countdown.of > 1 ? ` (frame ${countdown.shot} of ${countdown.of})` : ""}.
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { cancelRef.current = true; if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } setCountdown(null); }}
          >
            Cancel
          </Button>
        </div>
      )}

      {frames.length > 0 && <SnipCropper frames={frames} onAdd={acceptCrop} onClose={closeCropper} />}
    </div>
  );
}

/**
 * Crop stage.
 *
 * Rendered over the whole app on a near-opaque scrim, because judging a
 * selection needs the screenshot at the largest size that fits.
 *
 * Every colour here is a literal rather than a palette token. This surface is
 * deliberately dark in *both* themes — same reasoning as `.text-on-accent` — and
 * light mode remaps `white` and the slate ramp to ink, so `text-white` or
 * `text-slate-400` on this scrim would render near-black on near-black.
 */
function SnipCropper({
  frames,
  onAdd,
  onClose,
}: {
  frames: Frame[];
  onAdd: (f: File) => void;
  onClose: () => void;
}) {
  const [i, setI] = useState(0);
  const [sel, setSel] = useState<Sel | null>(null);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const frame = frames[i];

  const next = useCallback(() => {
    setSel(null);
    setI((n) => {
      if (n + 1 < frames.length) return n + 1;
      onClose();
      return n;
    });
  }, [frames.length, onClose]);

  const emit = useCallback(
    async (region: Sel | null, keepFrame: boolean) => {
      const img = imgRef.current;
      if (!img || busy) return;
      setBusy(true);
      try {
        const rect = img.getBoundingClientRect();
        // The image is rendered scaled-to-fit, so the selection is in display
        // pixels and has to be mapped back onto the frame's real pixels — the
        // crop is always taken from the full-resolution source.
        const k = frame.w / rect.width;
        const sx = region ? clamp(region.x * k, 0, frame.w) : 0;
        const sy = region ? clamp(region.y * k, 0, frame.h) : 0;
        const sw = region ? clamp(region.w * k, 1, frame.w - sx) : frame.w;
        const sh = region ? clamp(region.h * k, 1, frame.h - sy) : frame.h;

        const scale = clamp(MIN_LONG_EDGE / Math.max(sw, sh), 1, 3);
        const c = document.createElement("canvas");
        c.width = Math.round(sw * scale);
        c.height = Math.round(sh * scale);
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        // Matches the file-intake path: OCR engines read dark-on-white best, and
        // a white base means a transparent region never becomes black.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
        const blob = await canvasToBlob(c);
        if (!blob) return;
        onAdd(new File([blob], stamp(count + 1), { type: "image/png", lastModified: Date.now() }));
        setCount((n) => n + 1);
        if (keepFrame) setSel(null);
        else next();
      } finally {
        setBusy(false);
      }
    },
    [busy, frame.w, frame.h, onAdd, next, count],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "Enter") { e.preventDefault(); emit(sel, false); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [emit, sel, onClose]);

  const pos = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: clamp(e.clientX - r.left, 0, r.width), y: clamp(e.clientY - r.top, 0, r.height) };
  };

  const scaleBack = sel && imgRef.current ? frame.w / imgRef.current.getBoundingClientRect().width : 1;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/92 backdrop-blur-sm animate-[fadeIn_.12s_ease]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#ffffff1f] bg-[#0b0f19] px-4 py-2.5">
        <span className="text-sm font-semibold text-[#e2e8f0]">✂ Crop the formula</span>
        <span className="text-[11px] text-[#94a3b8]">
          Drag a box around one expression · {frame.w}×{frame.h}
          {frames.length > 1 ? ` · frame ${i + 1} of ${frames.length}` : ""}
          {count > 0 ? ` · ${count} added` : ""}
        </span>
        {sel && (
          <span className="rounded-full bg-[#ffffff14] px-2 py-0.5 text-[11px] text-[#a5b4fc]">
            {Math.round(sel.w * scaleBack)}×{Math.round(sel.h * scaleBack)} px
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={() => emit(null, false)}
            disabled={busy}
            className="rounded-lg border border-[#ffffff26] px-3 py-1.5 text-xs text-[#e2e8f0] hover:bg-[#ffffff14] disabled:opacity-40"
            title="Queue the whole frame without cropping. Accurate OCR usually needs a tight crop."
          >
            Use full frame
          </button>
          <button
            onClick={() => emit(sel, true)}
            disabled={busy || !sel}
            className="rounded-lg border border-[#8b5cf64d] bg-[#8b5cf61f] px-3 py-1.5 text-xs text-[#c4b5fd] hover:bg-[#8b5cf633] disabled:opacity-40"
            title="Queue this crop and stay on the same frame — for a page with several formulas."
          >
            ＋ Add &amp; select another
          </button>
          <Button variant="primary" size="sm" disabled={busy || !sel} onClick={() => emit(sel, false)}>
            ✓ Add crop{frames.length > 1 && i + 1 < frames.length ? " → next" : ""}
          </Button>
          <button
            onClick={next}
            className="rounded-lg border border-[#ffffff26] px-3 py-1.5 text-xs text-[#94a3b8] hover:bg-[#ffffff14]"
            title="Discard this frame"
          >
            {frames.length > 1 && i + 1 < frames.length ? "Skip →" : "Done"}
          </button>
          <button onClick={onClose} className="rounded-lg px-2 py-1.5 text-xs text-[#94a3b8] hover:bg-[#ffffff14]" title="Close (Esc)">✕</button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <div
          className="relative touch-none select-none"
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            const p = pos(e);
            startRef.current = p;
            setSel({ x: p.x, y: p.y, w: 0, h: 0 });
          }}
          onPointerMove={(e) => {
            if (!startRef.current) return;
            const p = pos(e);
            const s = startRef.current;
            setSel({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
          }}
          onPointerUp={() => {
            startRef.current = null;
            // A click with no drag is a mis-click, not a 0×0 crop.
            setSel((s) => (s && (s.w < 6 || s.h < 6) ? null : s));
          }}
        >
          <img
            ref={imgRef}
            src={frame.url}
            alt={`Screen capture ${frame.shot}`}
            draggable={false}
            className="max-h-[calc(100vh-9rem)] max-w-full cursor-crosshair rounded-lg shadow-2xl"
          />
          {sel && (
            // One element does both jobs: the ring marks the selection, and the
            // huge spread shadow dims everything outside it without a second
            // layer that would have to be kept in sync.
            <div
              className="pointer-events-none absolute rounded-[2px] ring-2 ring-violet-400"
              style={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h, boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)" }}
            />
          )}
        </div>
      </div>

      <div className="border-t border-[#ffffff1f] bg-[#0b0f19] px-4 py-2 text-center text-[11px] text-[#94a3b8]">
        Enter = add crop · Esc = close · crops smaller than {MIN_LONG_EDGE}px are upscaled automatically for sharper OCR
      </div>
    </div>
  );
}
