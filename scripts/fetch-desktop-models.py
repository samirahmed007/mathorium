#!/usr/bin/env python3
"""Fetch TexTeller ONNX INT8 weights at build time; never used by installed app."""
from __future__ import annotations
import hashlib,json,shutil
from pathlib import Path
from datetime import datetime,timezone
from huggingface_hub import model_info,snapshot_download
ROOT=Path(__file__).resolve().parents[1]
PUBLIC=ROOT/"public"; MODELS=PUBLIC/"models"; TARGET=MODELS/"texteller-int8"
REPO="onnx-community/TexTeller-ONNX"
ALLOW=["config.json","generation_config.json","preprocessor_config.json","processor_config.json","tokenizer.json","tokenizer_config.json","special_tokens_map.json","added_tokens.json","LICENSE","onnx/encoder_model_int8.onnx","onnx/decoder_model_int8.onnx"]
OPTIONAL={"processor_config.json","added_tokens.json","LICENSE"}
LIMITS={"onnx/encoder_model_int8.onnx":80_000_000,"onnx/decoder_model_int8.onnx":210_000_000}
def digest(p:Path)->str:
 h=hashlib.sha256()
 with p.open("rb") as f:
  for chunk in iter(lambda:f.read(8*1024*1024),b""):h.update(chunk)
 return h.hexdigest()
def main():
 print("Resolving "+REPO)
 info=model_info(REPO,revision="main",token=False);revision=info.sha
 if not revision or len(revision)<40:raise RuntimeError("Hub did not return immutable full model commit SHA")
 cache=ROOT/".cache"/"texteller-snapshot"
 snapshot_download(repo_id=REPO,revision=revision,local_dir=str(cache),allow_patterns=ALLOW,token=False,max_workers=4)
 TARGET.mkdir(parents=True,exist_ok=True);files={}
 for rel in ALLOW:
  src=cache/rel
  if not src.is_file():
   if rel in OPTIONAL:continue
   raise RuntimeError("Missing required upstream model file: "+rel)
  dst=TARGET/rel;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
  files[rel]={"bytes":dst.stat().st_size,"sha256":digest(dst)}
 for source,target in [("onnx/encoder_model_int8.onnx","onnx/encoder_model_quantized.onnx"),("onnx/decoder_model_int8.onnx","onnx/decoder_model_quantized.onnx")]:
  src=TARGET/source
  if src.stat().st_size<LIMITS[source]:raise RuntimeError("Weight file is too small (possible LFS pointer): "+source)
  dst=TARGET/target;shutil.copy2(src,dst)
  files[target]={"bytes":dst.stat().st_size,"sha256":digest(dst),"derived_from":source}
 required=["config.json","generation_config.json","preprocessor_config.json","tokenizer.json","tokenizer_config.json","onnx/encoder_model_quantized.onnx","onnx/decoder_model_quantized.onnx"]
 missing=[f for f in required if not (TARGET/f).is_file()]
 if missing:raise RuntimeError("TexTeller package incomplete: "+", ".join(missing))
 # Package the WASM files from the installed Transformers.js distribution; this
 # prevents the default CDN runtime path from being used by the desktop renderer.
 package_dist=ROOT/"node_modules"/"@huggingface"/"transformers"/"dist"
 wasm=list(package_dist.glob("ort-wasm*.wasm"))+list(package_dist.glob("ort-wasm*.mjs"))
 if not wasm:raise RuntimeError("No precompiled ONNX Runtime WASM files found in Transformers.js dist.")
 ort=PUBLIC/"ort-hf";ort.mkdir(parents=True,exist_ok=True)
 for p in wasm:shutil.copy2(p,ort/p.name)
 pix=MODELS/"pix2text-mfr-quantized"
 pix_required=["config.json","generation_config.json","preprocessor_config.json","tokenizer.json","onnx/encoder_model.onnx","onnx/decoder_model.onnx","onnx/decoder_model_int8.onnx"]
 pix_files={}
 for rel in pix_required:
  p=pix/rel
  if not p.is_file() or p.stat().st_size<100:raise RuntimeError("Missing/truncated Pix2Text asset: "+rel)
  pix_files[rel]={"bytes":p.stat().st_size,"sha256":digest(p)}
 manifest={"schema":1,"product":"Mathorium Desktop","created_at":datetime.now(timezone.utc).isoformat(),
  "texteller":{"repo_id":REPO,"revision":revision,"license":"Apache-2.0","quantization":"INT8","files":files},
  "pix2text":{"repo_id":"breezedeus/Pix2Text","bundled_recipe":"Existing Mathorium Pix2Text MFR recipe; do not change tokenizer/preprocessing/generation files independently.","files":pix_files},
  "runtime":{"transformers_js":"4.3.2","ort_wasm":sorted(p.name for p in ort.iterdir())}}
 (MODELS/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
 print("TexTeller INT8 pinned revision:",revision)
 print("Encoder bytes:",(TARGET/"onnx/encoder_model_int8.onnx").stat().st_size)
 print("Decoder bytes:",(TARGET/"onnx/decoder_model_int8.onnx").stat().st_size)
 print("SHA-256 manifest written.")
if __name__=="__main__":main()
