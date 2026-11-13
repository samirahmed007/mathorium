# Mathorium Desktop — Development Branch

This branch contains the first native desktop integration layer for the Mathorium repository.

## Implemented foundation

- Electron main process with a secure custom application protocol.
- Native global New Snip shortcut (default Ctrl+Alt+M).
- Per-display screenshot overlays with selection, move, resize, Enter and Escape.
- Electron preload bridge with context isolation and Node integration disabled.
- Native screenshot import into the existing Convert queue.
- Desktop OCR forced to local-only; cloud OCR is not used.
- Existing Pix2Text MFR inference adapter retained.
- TexTeller INT8 inference adapter using Transformers.js with remote model loading disabled.
- Fast, Balanced and High Accuracy options mapped to model decoding controls.
- IndexedDB local Snip Library.
- Settings for shortcut, model state, recognition quality and automatic conversion.
- Windows NSIS and portable build configuration.

## Foundation version note

The available upstream main branch identifies itself as Mathorium 9.0.0, not v10.0. This desktop branch sets the desktop package version to 10.0.0 but is built from the available public main source; it does not claim to contain an unprovided v10.0 archive.

## Build on Windows

Requires Node.js 22+, Python 3.12+, and Internet access during dependency and model acquisition.

1. Run npm install.
2. Install huggingface_hub with Python pip.
3. Run scripts/fetch-desktop-models.py.
4. Run npm run desktop:verify.
5. Run npm run build.
6. Run npx electron-builder --win nsis portable --x64 --publish never.

The installed application does not download model files. The build-time script is pinned to Hugging Face commit `9727784d91d7f8437dc7140941c4335284ce075e`, fetches only the INT8 encoder/decoder and required configuration/tokenizer resources, maps their local names for the Transformers.js q8 resolver, and writes SHA-256 details to public/models/manifest.json.


## TexTeller 3.0 lineage caveat

The prompts name both `TexTeller 3.0 INT8` and the `onnx-community/TexTeller-ONNX` INT8 export. The pinned ONNX export's published configuration identifies `OleehyO/TexTeller` as its base path. A distinct `onnx-community/TexTeller3-ONNX` export identifies `Ji-Ha/TexTeller3` as its base and does not list the same INT8 encoder/decoder pair. This branch follows the specific INT8 export URL supplied in the prompts and does not mix weights from the separate TexTeller3 export. Upstream does not unambiguously identify the pinned ONNX snapshot as a separately versioned “3.0 INT8” release; therefore the bundle should be described as the specified TexTeller ONNX INT8 snapshot unless its exact training-checkpoint lineage is independently confirmed.

## Bundled models

- Pix2Text MFR: the existing repository-tracked pix2text-mfr-quantized model directory, preserved as one recipe with its tokenizer, preprocessing and generation configuration.
- TexTeller: onnx-community/TexTeller-ONNX, explicit encoder_model_int8.onnx and decoder_model_int8.onnx source files, renamed for the Transformers.js q8 resolver without duplicating the binary weights; the original upstream filenames and SHA-256 records are retained in the model manifest.
- Transformers.js runtime WASM files: copied locally; CDN loading is disabled.
- The separate TexTeller3-ONNX export is not mixed into this bundle.

## Verification boundary

The Windows workflow checks required model assets, minimum sizes, manifest revision, and local WASM runtime before creating installer and portable artifacts. It must still undergo real Windows app launch, model loading, CPU inference, OCR accuracy, high-DPI/multi-monitor capture, batch, PDF, clipboard, offline network-disconnection, installer and clean-machine tests before being called a complete accepted release.

## Remaining product requirements

This first integration does not finish the PDF page workspace, Word/OMML export completion, a floating OCR result window, full backup/restore interface, model checksum verification on every installed launch, comprehensive inference-quality test suite, clean-install/uninstall tests, or exhaustive UI regression. These remain explicit next tasks, not claimed as done.
