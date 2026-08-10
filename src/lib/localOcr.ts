// Local Math OCR — 100% offline, no API key, no network, no account.
//
// PRIMARY: Pix2Text MFR (breezedeus/pix2text-mfr) — the strongest open-source
// math-formula recognizer and the usual MathPix alternative. Model files are
// BUNDLED in /models/pix2text-mfr-quantized/, so the first run works air-gapped.
//
// The engine lives in `pix2text.ts` and drives onnxruntime-web directly. It does
// NOT go through transformers.js: the shipped decoder is cache-less (inputs are
// just `input_ids` + `encoder_hidden_states`), while transformers.js v3 drives
// VisionEncoderDecoder with KV-cache semantics, so the session contract never
// matched and every call threw. That mismatch is what produced the old
// "Local OCR enabled but nothing works" behaviour.
//
// Tesseract is available as an explicitly-chosen plain-text engine. It is NOT a
// math model and is never used as a silent fallback — doing that is what turned
// failed math OCR into confident garbage like "Zli - 0r)1||, z|1 - 20a = 0".

import {
  loadPix2Text,
  recognizeFormula,
  isPix2TextLoaded,
  disposePix2Text,
  getPix2TextThreadInfo,
} from "./pix2text";
import { repairPix2TextLatex, type RepairIssue } from "./pix2textRepair";

export type LocalOCRModel = "auto" | "pix2text" | "tesseract";

export interface LocalOCROpts {
  model?: LocalOCRModel;
  signal?: AbortSignal;
  onProgress?: (progress: number, status: string) => void;
  /**
   * Run the repair pass over the decoder's output (Settings.pix2textRepair).
   *
   * This has to be decided here rather than by the caller after the fact, because the
   * delimiter-shape correction needs the decoder's per-step alternatives and those only
   * exist during recognition — see reconcileDelimiterShapes.
   */
  repair?: boolean;
}

export interface LocalOCRResult {
  text: string;
  confidence: number;
  model: string;
  backend: string;
  /** True when the text is already LaTeX and needs no LLM post-processing. */
  isLatex: boolean;
  tokens?: number;
  ms?: number;
  /** What the repair pass changed or flagged, when `repair` was requested. */
  repairs?: RepairIssue[];
}

/**
 * Settings persisted by older builds may still hold retired ids
 * ("pix2text-quantized", "trocr"). Map them onto what actually ships.
 */
export function normalizeLocalOCRModel(model: string | undefined | null): LocalOCRModel {
  switch (model) {
    case "pix2text":
    case "pix2text-quantized":
      return "pix2text";
    case "tesseract":
      return "tesseract";
    default:
      // "auto", "trocr" (removed), undefined, or anything unrecognized.
      return "auto";
  }
}

export function isWebGPUAvailable(): boolean {
  if (typeof navigator === "undefined") return false;
  return !!(navigator as any).gpu;
}

// ---------------------------------------------------------------------------
// Tesseract (optional, plain text only)
// ---------------------------------------------------------------------------

let tesseractWorker: any = null;
let tesseractLoading: Promise<any> | null = null;

async function loadTesseract(onProgress?: (p: number, s: string) => void): Promise<any> {
  if (tesseractWorker) return tesseractWorker;
  if (tesseractLoading) return tesseractLoading;

  tesseractLoading = (async () => {
    onProgress?.(0.1, "Loading Tesseract.js...");
    const Tesseract: any = await import(/* @vite-ignore */ "https://esm.sh/tesseract.js@5.1.1");
    onProgress?.(0.3, "Creating worker...");
    const createWorker = Tesseract.createWorker || Tesseract.default?.createWorker;
    const worker = await createWorker("eng", 1, {
      logger: (m: any) => {
        if (m.status === "recognizing text") onProgress?.(0.3 + (m.progress || 0) * 0.6, "Recognizing...");
        else if (m.status) onProgress?.(0.3, m.status + "...");
      },
    });
    onProgress?.(1, "Tesseract ready");
    tesseractWorker = worker;
    return worker;
  })();

  try {
    return await tesseractLoading;
  } catch (e) {
    tesseractLoading = null;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run local OCR on an image (data URL, blob URL, or same-origin URL).
 *
 * "auto" and "pix2text" both use Pix2Text MFR. There is deliberately no
 * automatic downgrade to Tesseract: for a math image, a Tesseract result is
 * worse than an honest failure, because the caller can still fall back to a
 * vision LLM that actually understands math.
 */
export async function runLocalOCR(dataUrl: string, opts: LocalOCROpts = {}): Promise<LocalOCRResult> {
  const model = normalizeLocalOCRModel(opts.model);
  const { signal, onProgress, repair = true } = opts;

  if (model === "tesseract") {
    const worker = await loadTesseract(onProgress);
    if (signal?.aborted) throw new Error("Aborted");
    onProgress?.(0.92, "Running Tesseract...");
    const { data } = await worker.recognize(dataUrl);
    const text = (data.text || "").trim();
    if (!text) throw new Error("Tesseract produced no text.");
    return {
      text,
      confidence: data.confidence ? data.confidence / 100 : 0.6,
      model: "Tesseract (plain text)",
      backend: "wasm",
      isLatex: false,
    };
  }

  // Pix2Text MFR — the math path.
  const t0 = performance.now();
  await loadPix2Text({ onProgress, signal });
  if (signal?.aborted) throw new Error("Aborted");

  const res = await recognizeFormula(dataUrl, { signal, onProgress, collectAlternatives: repair });
  const text = (res.latex || "").trim();
  if (!text) throw new Error("Pix2Text returned an empty result — the image may not contain a formula.");
  // A degenerate decode is confident-looking garbage (e.g. one symbol repeated 50
  // times on a blank crop). Reporting it as success is the exact failure mode this
  // engine was rewritten to eliminate, so surface it as an error instead.
  if (res.degenerate) {
    throw new Error(
      "Pix2Text could not read a formula in this image (the decode did not converge). " +
        "Crop tightly to a single formula — full pages, blank areas and plain text are not supported by this model.",
    );
  }

  const { threads } = getPix2TextThreadInfo();
  // Delimiter shapes were already reconciled inside the decoder (it is the only place
  // the per-token alternatives exist); this second pass is the string-level half of
  // the repair — doubled braces, spaced operator names, TeX 2.09 font switches, and
  // the balance checks that can only be reported.
  let finalText = text;
  let repairs: RepairIssue[] | undefined;
  if (repair) {
    const rep = repairPix2TextLatex(text);
    finalText = rep.latex;
    repairs = [...(res.delimiterIssues || []), ...rep.issues];
  }

  return {
    text: finalText,
    confidence: 0.92,
    model: "Pix2Text MFR (local)",
    backend: `wasm×${threads}`,
    isLatex: true,
    tokens: res.tokens,
    ms: Math.round(performance.now() - t0),
    ...(repairs && repairs.length ? { repairs } : {}),
  };
}

/** Warm the engine so the first real conversion isn't paying model-load cost. */
export async function preloadLocalOCR(
  model: LocalOCRModel = "auto",
  onProgress?: (p: number, s: string) => void,
): Promise<void> {
  if (normalizeLocalOCRModel(model) === "tesseract") {
    await loadTesseract(onProgress);
    return;
  }
  await loadPix2Text({ onProgress });
}

export function isLocalOCRAvailable(): boolean {
  return typeof WebAssembly !== "undefined";
}

export function isLocalOCRLoaded(): boolean {
  return isPix2TextLoaded();
}

export function getLocalOCRBackendInfo(): { threads: number; isolated: boolean } {
  return getPix2TextThreadInfo();
}

export function getModelSize(model: LocalOCRModel): string {
  switch (normalizeLocalOCRModel(model)) {
    case "tesseract":
      return "~10 MB (downloaded on first use)";
    default:
      return "~31 MB (bundled — works offline)";
  }
}

export async function unloadLocalOCR(): Promise<void> {
  await disposePix2Text();
  if (tesseractWorker) {
    try {
      await tesseractWorker.terminate();
    } catch {
      /* ignore */
    }
    tesseractWorker = null;
  }
  tesseractLoading = null;
}
