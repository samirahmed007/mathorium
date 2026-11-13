import { env, pipeline } from "@huggingface/transformers";
import type { RecognitionQuality } from "./localOcr";

type Progress=(progress:number,status:string)=>void;
type Options={signal?:AbortSignal;onProgress?:Progress;quality?:RecognitionQuality};
type Result={text:string;backend:string;warnings:string[]};
let modelPromise:Promise<any>|null=null;
let modelLimit=512;
let turn=Promise.resolve();

function configureOffline() {
  const base=new URL("models/",document.baseURI).href;
  (env as any).allowRemoteModels=false;
  (env as any).allowLocalModels=true;
  (env as any).useBrowserCache=false;
  (env as any).localModelPath=base;
  // Transformers.js and the existing Pix2Text runtime use separate copied WASM
  // directories so a package can pin compatible ONNX Runtime builds.
  const backends=(env as any).backends;
  if(backends?.onnx?.wasm) {
    backends.onnx.wasm.wasmPaths=new URL("ort-hf/",document.baseURI).href;
    backends.onnx.wasm.numThreads=1;
  }
}
async function loadConfig(progress?:Progress) {
  configureOffline();
  const root=new URL("models/texteller-int8/",document.baseURI);
  const response=await fetch(new URL("generation_config.json",root));
  if(!response.ok)throw new Error("TexTeller model bundle is missing generation_config.json. Rebuild the desktop package with both model assets.");
  const config=await response.json();
  const reported=Number(config.max_new_tokens||config.max_length||512);
  modelLimit=Math.max(128,Math.min(2048,Number.isFinite(reported)?reported:512));
  progress?.(0.08,"Checking bundled TexTeller INT8 files");
}
export async function preloadTexTeller(progress?:Progress):Promise<void> {
  if(modelPromise)return modelPromise.then(()=>undefined);
  modelPromise=(async()=>{
    await loadConfig(progress);
    progress?.(0.12,"Loading TexTeller INT8 encoder and decoder");
    return await pipeline("image-to-text","texteller-int8",{
      device:"wasm",
      dtype:"q8",
      progress_callback:(event:any)=>{
        if(event?.status==="progress")progress?.(0.12+0.78*(Number(event.progress)||0)/100,"Loading TexTeller model files");
        else if(event?.status)progress?.(0.15,String(event.status));
      }
    } as any);
  })();
  try {await modelPromise;progress?.(1,"TexTeller INT8 ready (offline)");}
  catch(e){modelPromise=null;throw e;}
}
function inspectOutput(text:string):string[] {
  const warnings:string[]=[];
  let braces=0;
  for(const ch of text){if(ch==="{")braces++;else if(ch==="}")braces--;}
  if(braces!==0)warnings.push("The generated LaTeX has unbalanced braces; inspect the source image before using it.");
  if(/\\(frac|sqrt|sum|prod|int|begin|left|right|operatorname)\s*$/.test(text.trim())||/[=+\-*/^_\\,{]$/.test(text.trim()))
    warnings.push("The output ends at a mathematical continuation point and may be truncated.");
  const begins=(text.match(/\\begin\s*\{/g)||[]).length,ends=(text.match(/\\end\s*\{/g)||[]).length;
  if(begins!==ends)warnings.push("The output has unmatched LaTeX environment delimiters.");
  return warnings;
}
async function serialized<T>(work:()=>Promise<T>):Promise<T>{
  let release!:()=>void;
  const previous=turn;
  turn=new Promise<void>(resolve=>{release=resolve;});
  await previous;
  try{return await work();}finally{release();}
}
export async function runTexTellerOCR(dataUrl:string,options:Options={}):Promise<Result>{
  return serialized(async()=>{
    if(options.signal?.aborted)throw new Error("Recognition cancelled.");
    await preloadTexTeller(options.onProgress);
    if(options.signal?.aborted)throw new Error("Recognition cancelled.");
    options.onProgress?.(0.05,"Preparing image for TexTeller");
    const imageResponse=await fetch(dataUrl);
    if(!imageResponse.ok)throw new Error("Could not read the selected image.");
    const image=await createImageBitmap(await imageResponse.blob());
    try{
      const q=options.quality||"balanced";
      const beams=q==="high-accuracy"?4:q==="balanced"?2:1;
      const output=await (await modelPromise)(image,{
        max_new_tokens:modelLimit,
        num_beams:beams,
        do_sample:false,
        early_stopping:true,
      });
      if(options.signal?.aborted)throw new Error("Recognition cancelled.");
      const text=Array.isArray(output)?String(output[0]?.generated_text??""):String(output?.generated_text??output??"");
      if(!text.trim())throw new Error("TexTeller produced an empty result. Check that the crop contains a mathematical expression.");
      const warnings=inspectOutput(text);
      options.onProgress?.(1,warnings.length?"Recognition finished — review completeness warnings":"Recognition finished");
      return {text:text.trim(),backend:"Transformers.js · ONNX Runtime Web · CPU/WASM",warnings};
    }finally{image.close();}
  });
}
export async function unloadTexTeller():Promise<void>{
  if(!modelPromise)return;
  try{const p=await modelPromise;await p?.model?.dispose?.();await p?.dispose?.();}catch{/* Safe unload must not crash the app. */}
  modelPromise=null;
}
