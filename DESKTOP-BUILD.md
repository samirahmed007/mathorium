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
- TexTeller 3.0 INT8 ONNX inference adapter using Transformers.js with remote model loading disabled.
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

The installed application does not download model files. The build-time script is pinned to Hugging Face commit `ed90c6164810242882ca90863bb85697a76f4841`, fetches the TexTeller3 quantized encoder and merged decoder plus their matching processor, tokenizer and configuration files, and records SHA-256 hashes in public/models/manifest.json.


## Model provenance

The TexTeller bundle is sourced from `onnx-community/TexTeller3-ONNX` at immutable revision `ed90c6164810242882ca90863bb85697a76f4841`. The model repository identifies the model as a conversion of `Ji-Ha/TexTeller3` and provides the quantized encoder, merged quantized decoder, and matching grayscale 448×448 preprocessing configuration. The app uses the Q8/INT8 ONNX variants with Transformers.js; the 8.5 GB repository contains other non-quantized variants that are not included.

## Verification boundary

The Windows workflow checks required model assets, minimum sizes, manifest revision, and local WASM runtime before creating installer and portable artifacts. It must still undergo real Windows app launch, model loading, CPU inference, OCR accuracy, high-DPI/multi-monitor capture, batch, PDF, clipboard, offline network-disconnection, installer and clean-machine tests before being called a complete accepted release.

## Remaining product requirements

This first integration does not finish the PDF page workspace, Word/OMML export completion, a floating OCR result window, full backup/restore interface, model checksum verification on every installed launch, comprehensive inference-quality test suite, clean-install/uninstall tests, or exhaustive UI regression. These remain explicit next tasks, not claimed as done.
