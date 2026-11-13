import fs from "node:fs";
import path from "node:path";
const root=process.cwd(),models=path.join(root,"public","models"),manifestPath=path.join(models,"manifest.json");
const required={
"Pix2Text MFR":["pix2text-mfr-quantized/config.json","pix2text-mfr-quantized/generation_config.json","pix2text-mfr-quantized/preprocessor_config.json","pix2text-mfr-quantized/tokenizer.json","pix2text-mfr-quantized/onnx/encoder_model.onnx","pix2text-mfr-quantized/onnx/decoder_model.onnx","pix2text-mfr-quantized/onnx/decoder_model_int8.onnx"],
"TexTeller3 INT8":["texteller3-int8/config.json","texteller3-int8/generation_config.json","texteller3-int8/preprocessor_config.json",
"texteller3-int8/special_tokens_map.json",
"texteller3-int8/merges.txt",
"texteller3-int8/vocab.json",
"texteller3-int8/quantize_config.json","texteller3-int8/tokenizer.json","texteller3-int8/tokenizer_config.json","texteller3-int8/onnx/encoder_model_quantized.onnx","texteller3-int8/onnx/decoder_model_merged_quantized.onnx"]};
const missing=[];
for(const [engine,files] of Object.entries(required))for(const file of files)if(!fs.existsSync(path.join(models,file)))missing.push(engine+": "+file);
if(missing.length){console.error("Missing model assets:\n"+missing.join("\n"));process.exit(1);}
if(!fs.existsSync(manifestPath)){console.error("Model manifest missing: run the offline model staging script first.");process.exit(1);}
const manifest=JSON.parse(fs.readFileSync(manifestPath,"utf8"));
if(manifest.schema!==1||!manifest.texteller3?.revision||!manifest.pix2text?.files){console.error("Model manifest is incomplete or lacks a pinned revision.");process.exit(1);}
for(const [engine,files] of Object.entries(required))for(const rel of files){
  const p=path.join(models,rel),size=fs.statSync(p).size;
  const minimum=rel.endsWith(".onnx")?1_000_000:16;
  if(size<minimum){console.error(engine+" asset is empty or truncated: "+rel+" ("+size+" bytes)");process.exit(1);}
  if(rel.endsWith(".json")){
    try{JSON.parse(fs.readFileSync(p,"utf8"));}catch{console.error(engine+" JSON asset is invalid: "+rel);process.exit(1);}
  }
}
const ort=path.join(root,"public","ort-hf");
const wasm=fs.existsSync(ort)?fs.readdirSync(ort).filter(n=>n.endsWith(".wasm")):[];
if(!wasm.length||wasm.some(n=>fs.statSync(path.join(ort,n)).size<1000000)){console.error("Transformers.js offline WASM runtime missing or truncated.");process.exit(1);}
if(!fs.existsSync(path.join(root,"public","ort","ort-wasm-simd-threaded.wasm"))){console.error("Pix2Text ONNX Runtime WASM missing.");process.exit(1);}
console.log("✓ Both offline model bundles, manifest and WASM runtimes are present.");
console.log("  TexTeller revision: "+manifest.texteller.revision);
