// Strictly local mathematical OCR. Desktop builds ship exactly two engines:
// Pix2Text MFR (the existing, pinned recipe) and TexTeller INT8.
import {
  loadPix2Text, recognizeFormula, isPix2TextLoaded, disposePix2Text, getPix2TextThreadInfo,
} from "./pix2text";
import { repairPix2TextLatex, type RepairIssue } from "./pix2textRepair";
import { runTexTellerOCR, preloadTexTeller, unloadTexTeller } from "./texteller";

export type LocalOCRModel = "auto" | "pix2text" | "texteller";
export type RecognitionQuality = "fast" | "balanced" | "high-accuracy";
export interface LocalOCROpts {
  model?: LocalOCRModel;
  quality?: RecognitionQuality;
  signal?: AbortSignal;
  onProgress?: (progress:number,status:string)=>void;
  repair?: boolean;
}
export interface LocalOCRResult {
  text:string; model:string; backend:string; isLatex:boolean;
  tokens?:number; ms?:number; repairs?:RepairIssue[]; warnings?:string[];
}
export function normalizeLocalOCRModel(model:string|null|undefined):LocalOCRModel {
  if(model==="pix2text"||model==="texteller")return model;
  // Old persisted "auto" and retired Tesseract settings migrate to the safe math default.
  return "pix2text";
}
export function isWebGPUAvailable():boolean {
  return typeof navigator!=="undefined" && !!(navigator as any).gpu;
}
export async function runLocalOCR(dataUrl:string,opts:LocalOCROpts={}):Promise<LocalOCRResult> {
  const model=normalizeLocalOCRModel(opts.model), started=performance.now();
  if(opts.signal?.aborted)throw new Error("Recognition cancelled.");
  if(model==="texteller") {
    const result=await runTexTellerOCR(dataUrl,{signal:opts.signal,onProgress:opts.onProgress,quality:opts.quality||"balanced"});
    if(!result.text.trim())throw new Error("TexTeller returned an empty result.");
    return {text:result.text.trim(),model:"TexTeller INT8 (offline)",backend:result.backend,isLatex:true,ms:Math.round(performance.now()-started),warnings:result.warnings};
  }
  await loadPix2Text({onProgress:opts.onProgress,signal:opts.signal});
  if(opts.signal?.aborted)throw new Error("Recognition cancelled.");
  const useAlternatives=opts.quality==="high-accuracy" || (opts.quality!=="fast" && opts.repair!==false);
  const result=await recognizeFormula(dataUrl,{signal:opts.signal,onProgress:opts.onProgress,collectAlternatives:useAlternatives});
  const raw=(result.latex||"").trim();
  if(!raw)throw new Error("Pix2Text returned no formula. Crop tightly around one mathematical expression and retry.");
  if(result.degenerate)throw new Error("Pix2Text could not complete a reliable decode. The output reached a repetition or token-cap condition; the source image has been preserved.");
  let text=raw,repairs:RepairIssue[]|undefined;
  if(opts.repair!==false && opts.quality!=="fast") {
    const fixed=repairPix2TextLatex(raw);text=fixed.latex;
    repairs=[...(result.delimiterIssues||[]),...fixed.issues];
  }
  const threads=getPix2TextThreadInfo().threads;
  return {text,model:"Pix2Text MFR (offline)",backend:"ONNX Runtime WebAssembly ×"+threads,isLatex:true,tokens:result.tokens,ms:Math.round(performance.now()-started),...(repairs?.length?{repairs}:{}),...(result.degenerate?{warnings:["Possible incomplete output"]}:{})};
}
export async function preloadLocalOCR(model:LocalOCRModel="pix2text",onProgress?:(p:number,s:string)=>void):Promise<void> {
  if(normalizeLocalOCRModel(model)==="texteller") {
    await preloadTexTeller(onProgress);
    return;
  }
  await loadPix2Text({onProgress});
}
export function isLocalOCRAvailable():boolean{return typeof WebAssembly!=="undefined";}
export function isLocalOCRLoaded():boolean{return isPix2TextLoaded();}
export function getLocalOCRBackendInfo():{threads:number;isolated:boolean}{return getPix2TextThreadInfo();}
export function getModelSize(model:LocalOCRModel):string{return normalizeLocalOCRModel(model)==="texteller"?"~316 MB INT8 model + tokenizer/configuration (bundled)":"~62 MB ONNX weights + tokenizer/configuration (bundled)";}
export async function unloadLocalOCR():Promise<void>{await disposePix2Text();await unloadTexTeller();}
