// Strictly local mathematical OCR. Desktop builds ship exactly two engines:
// Pix2Text MFR (the existing, pinned recipe) and TexTeller INT8.
import {
  loadPix2Text, recognizeFormula, isPix2TextLoaded, disposePix2Text, getPix2TextThreadInfo,
} from "./pix2text";
import { repairPix2TextLatex, type RepairIssue } from "./pix2textRepair";
import { runTexTellerOCR, preloadTexTeller, unloadTexTeller } from "./texteller";

export type LocalOCRModel = "auto" | "pix2text" | "texteller" | "tesseract";
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
  // The desktop product admits only the two bundled mathematical models.
  if(typeof window!=="undefined" && window.mathoriumDesktop?.isDesktop) {
    return model==="texteller" ? "texteller" : "pix2text";
  }
  if(model==="tesseract")return "tesseract"; // web-only, explicit plain-text OCR option
  if(model==="pix2text"||model==="texteller")return model;
  return "pix2text";
}

let tesseractWorker:any=null;
let tesseractLoading:Promise<any>|null=null;
async function loadWebTesseract(onProgress?: (p:number,s:string)=>void):Promise<any> {
  if(tesseractWorker)return tesseractWorker;
  if(tesseractLoading)return tesseractLoading;
  tesseractLoading=(async()=>{
    onProgress?.(0.1,"Loading web-only Tesseract.js");
    const module:any=await import(/* @vite-ignore */ "https://esm.sh/tesseract.js@5.1.1");
    const createWorker=module.createWorker||module.default?.createWorker;
    const worker=await createWorker("eng",1,{logger:(m:any)=>{
      if(m.status==="recognizing text")onProgress?.(0.3+(m.progress||0)*0.6,"Recognizing plain text");
      else if(m.status)onProgress?.(0.3,String(m.status));
    }});
    tesseractWorker=worker;onProgress?.(1,"Tesseract ready");return worker;
  })();
  try{return await tesseractLoading;}catch(error){tesseractLoading=null;throw error;}
}
export function isWebGPUAvailable():boolean {
  return typeof navigator!=="undefined" && !!(navigator as any).gpu;
}
export async function runLocalOCR(dataUrl:string,opts:LocalOCROpts={}):Promise<LocalOCRResult> {
  const model=normalizeLocalOCRModel(opts.model), started=performance.now();
  if(opts.signal?.aborted)throw new Error("Recognition cancelled.");
  if(model==="tesseract") {
    if(typeof window!=="undefined" && window.mathoriumDesktop?.isDesktop)throw new Error("Tesseract is not available in Mathorium Desktop. Select Pix2Text MFR or TexTeller INT8.");
    const worker=await loadWebTesseract(opts.onProgress);
    if(opts.signal?.aborted)throw new Error("Recognition cancelled.");
    const {data}=await worker.recognize(dataUrl);
    const text=String(data?.text||"").trim();
    if(!text)throw new Error("Tesseract produced no text.");
    return {text,model:"Tesseract (web-only plain text)",backend:"WebAssembly",isLatex:false,ms:Math.round(performance.now()-started)};
  }
  if(model==="texteller") {
    const result=await runTexTellerOCR(dataUrl,{signal:opts.signal,onProgress:opts.onProgress,quality:opts.quality||"balanced"});
    if(!result.text.trim())throw new Error("TexTeller returned an empty result.");
    return {text:result.text.trim(),model:"TexTeller3 INT8 (offline)",backend:result.backend,isLatex:true,ms:Math.round(performance.now()-started),warnings:result.warnings};
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
  if(normalizeLocalOCRModel(model)==="tesseract") { await loadWebTesseract(onProgress); return; }
  if(normalizeLocalOCRModel(model)==="texteller") {
    await preloadTexTeller(onProgress);
    return;
  }
  await loadPix2Text({onProgress});
}
export function isLocalOCRAvailable():boolean{return typeof WebAssembly!=="undefined";}
export function isLocalOCRLoaded():boolean{return isPix2TextLoaded();}
export function getLocalOCRBackendInfo():{threads:number;isolated:boolean}{return getPix2TextThreadInfo();}
export function getModelSize(model:LocalOCRModel):string {
  const selected=normalizeLocalOCRModel(model);
  return selected==="tesseract" ? "~10 MB (web-only, fetched on first use)" : selected==="texteller" ? "~316 MB INT8 model + tokenizer/configuration (bundled)" : "~62 MB ONNX weights + tokenizer/configuration (bundled)";
}
export async function unloadLocalOCR():Promise<void>{
  await disposePix2Text();await unloadTexTeller();
  if(tesseractWorker){try{await tesseractWorker.terminate();}catch{/* ignore */}tesseractWorker=null;}
  tesseractLoading=null;
}
