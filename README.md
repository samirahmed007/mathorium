# Mathorium 9.0 — Free AI Math OCR & LaTeX / MathML Studio

> **100% client-side · No API key · No signup · No backend · Bundled Pix2Text model**
> The open **Mathpix alternative**. Live at **<https://mathorium.vercel.app/>**

Convert any mathematics — handwriting, printed textbooks, PDF screenshots, whiteboards,
matrices, integrals, tensors — into single-line **LaTeX** and presentation **MathML**.
Batch hundreds of images, edit the result in a visual equation editor, chat about maths
with live rendering, and export to nine formats. Nothing is uploaded anywhere unless you
pick a cloud provider yourself.

Developed by **Samir Uddin Ahmed**

---

## What's new in 9.0

Version 9.0 is the rename release — the app was previously called MathForge — but most of
the work went into the parts that were quietly broken.

**New**

- **Live model lists.** Every provider fetches its own catalogue from its `/models`
  endpoint, and each model is marked vision-capable or free from what the provider
  actually reports. The old hand-maintained list went stale the moment a provider shipped
  anything.
- **Screen snip in Convert.** Capture a region of your screen — with a delay, or on
  repeat — crop it, and drop it straight into the conversion queue. No more
  screenshot-to-file-to-upload.
- **Image generation across the free providers,** including Perchance, with the available
  image models listed per provider rather than hardcoded.
- **Local GGUF models from the Providers tab,** not only from Settings.
- **Rebuilt chat rendering:** tables, callouts, footnotes, task lists, per-block copy,
  and maths that renders mid-stream without reflowing the whole message.
- **A crawlable landing shell.** The app is one 17 MB inlined document, so a search engine
  used to receive an empty `<div>`. It now ships real copy that React replaces on mount.

**Fixed**

- **Light and System themes,** rebuilt from the token layer up. Previously the light theme
  was unusable in places. Verified at **zero low-contrast nodes** across every tab in all
  four theme modes (`scripts/theme-audit.mjs`).
- **Voice input** works, and when a browser refuses the microphone it says which reason
  applies instead of failing silently.
- **The CORS proxy** falls back silently when a provider blocks browser calls, and you can
  stop it from Settings.
- **One version constant.** v8.3 shipped four different version numbers in one build —
  header, sidebar, About and Settings all disagreed. There is now a single
  `src/lib/version.ts`, and the build fails if it drifts from `package.json`.

Earlier: **v8** added Agent Mode, the MathType editor as a standalone tab, undo/redo and
local GGUF models. **v7** added offline Pix2Text OCR and replies that continue past the
token cap.

Full release notes, including what was deliberately *not* changed and why, are in
**[CHANGELOG.md](CHANGELOG.md)**.

---

## Quick start

```bash
npm install
npm run build               # → dist/
npx vite preview --port 4173
```

Open <http://localhost:4173>.

Development, with hot reload:

```bash
npm run dev                 # → http://localhost:5173
```

You can also just double-click `dist/index.html` — the whole UI is inlined into that one
file. Everything works there except offline OCR, because browsers refuse `fetch()` over
`file://`. See **[HOW_TO_RUN_AND_TEST.md](HOW_TO_RUN_AND_TEST.md)** for the full picture.

### Giving it to other people, with no installation

Three shapes, none of which asks the user to install Node, Python or an extension:

| You send / host | User does | Offline OCR |
| --- | --- | --- |
| The single file `dist/index.html` (~17 MB) | Double-click it | ✗ |
| `dist/` on any static host (Vercel, Netlify, Pages, IIS…) | Opens a URL | ✓ |
| `dist/` on a LAN box (`npx serve dist`) | Opens a URL | ✓ (no internet at all) |

Served over HTTP it is an installable PWA.

---

## Features

### Convert — image → LaTeX / MathML

- **Local OCR** with the bundled **Pix2Text MFR** ONNX model: no key, no network, fully
  private. See [Upgrading the OCR model](#upgrading-the-pix2text-ocr-model).
- **Screen snip:** delayed and repeat capture, crop region, straight into the queue.
- **Cloud OCR** as an alternative or fallback, with auto-rotation between providers so a
  usage limit on one silently moves to the next.
- Three modes: expression · line-by-line · mixed text + maths.
- Batch 500+ images, auto-retry ×3, retry-failed-only.

### MathType tab — visual equation editor

Visual and LaTeX panes side by side, both live, editing the same expression. 20 palette
groups plus a tabbed template bar; ~350 symbols. The source image sits beside the editor
when you arrive from a converted expression. Paste MathML / LaTeX / rendered maths;
undo-redo across both panes; zoom; copy or save as `.tex` / `.mml`.

### LaTeX tab

Symbol palettes, 29 keyboard shortcuts, live KaTeX preview, multi-engine MathML export,
worked examples, smart paste.

### Chat

Streaming replies, **Agent Mode** (plan → solve → audit → correct) with a live workflow
trace, a thinking panel for reasoning models, conversation history, token counter, voice
input, image generation, file/ZIP attachments, Markdown + LaTeX rendering.

### Export — 9 formats

HTML double-column · HTML + ZIP · HTML single · LaTeX · MathML · Markdown · CSV · JSON · TXT

---

## What's in the package

```
mathorium/
├── dist/                     ← production build (~107 MB total)
│   ├── index.html            ← the entire app, inlined (~17 MB / 5.3 MB gzip)
│   ├── models/               ← bundled Pix2Text MFR ONNX model (~58 MB)
│   ├── ort/                  ← onnxruntime-web WASM binaries (~31 MB)
│   ├── manifest.json, sw.js  ← PWA install + offline cache
│   └── robots.txt, sitemap.xml, og.png
├── src/
│   ├── components/           ← tabs (Convert, LaTeX, MathType, Chat, Settings…)
│   ├── lib/pix2text.ts       ← local ONNX math OCR engine
│   ├── lib/version.ts        ← the only place name and version are written down
│   └── lib/storage.ts        ← persistence + schema migrations
├── public/                   ← static assets copied into dist/
├── scripts/                  ← verification probes (see below)
├── vercel.json               ← headers, caching, build config
└── vite.config.ts            ← single-file build, script placement, model copying
```

Only `index.html` is required. `models/` and `ort/` are needed just for offline OCR;
`manifest.json` and `sw.js` just for PWA install.

---

## Verification

There is no unit-test suite. Instead each feature has a probe that drives the **built
artifact** in a real browser and asserts on what actually renders — which is the only
thing that catches "it compiles, it typechecks, and the button does nothing".

```bash
node scripts/theme-audit.mjs      # contrast across 4 theme modes × 7 tabs
node scripts/rebrand-probe.mjs    # name/version on every surface that states one
node scripts/seo-probe.mjs        # head, JSON-LD, crawlable shell, robots, sitemap
node scripts/brand-probe.mjs      # the mark in header/About/avatar, icon set, deep links
node scripts/markdown-probe.mjs   # chat content rendering, streaming
node scripts/snip-probe.mjs       # screen snip
node scripts/voice-probe.mjs      # voice input, including the blocked-microphone path
node scripts/imagegen-probe.mjs   # image generation and engine listing
node scripts/mathfield-probe.mjs  # the visual equation editor
```

Run `npm run build` first — they all read `dist/`.

`scripts/make-icons.mjs` rasterises every PNG icon and the OG card from
`public/icon.svg`, so the icons cannot drift from the in-app logo.

---

## Deploying to Vercel

The repo carries a `vercel.json` that sets the build command, security headers, and cache
policy (immutable for the content-addressed model weights, `must-revalidate` for `/` —
a stale inlined `index.html` is a stale app).

### First deploy

```bash
npm i -g vercel
vercel login
vercel link          # create a new project, or link an existing one
vercel --prod
```

Or from the dashboard: **Add New → Project → import the Git repo**. Framework preset
**Vite**, build `npm run build`, output `dist`. Nothing else needs configuring — there are
no environment variables, because there is no backend and no server-side key.

### Redeploying

| What you want | How |
| --- | --- |
| Ship the current code | `git push` — the Git integration builds and deploys automatically |
| Ship without a commit | `vercel --prod` from the project root |
| Re-run the last build unchanged | Dashboard → Deployments → ⋯ → **Redeploy** |
| Roll back | Dashboard → Deployments → pick an older one → **Promote to Production** |

Redeploying **replaces** the production deployment; the previous one stays reachable at
its own immutable URL, which is what makes rollback instant.

**After a deploy, hard-refresh once.** The service worker caches the previous bundle under
a release-scoped name (`mathorium-v9.0-cache-v1`), so bumping `APP_VERSION` is what
invalidates it. If you ship a change without bumping the version, returning PWA users keep
the old bundle.

### Removing a deployment or project

- **One deployment:** Dashboard → Deployments → ⋯ → **Delete**. Or `vercel remove <url>`.
- **The whole project:** Settings → **Delete Project**. This frees the
  `<name>.vercel.app` subdomain for reuse.
- **From the CLI:** `vercel remove <project-name> --yes` (removes all its deployments).

Deleting a project is irreversible and takes its analytics and deployment history with it.
If the goal is only to take the site down, unassign the domain instead.

### Fresh deploy under a new name

The single-file build has no absolute URLs in it, so a new project needs no code change —
except the ones that name the site for search engines. If you deploy to a different
hostname, update:

- `index.html` — `<link rel="canonical">`, `og:url`, `og:image`, `twitter:image`, and the
  `@id`/`url` fields in the JSON-LD block
- `public/robots.txt` — the `Sitemap:` line
- `public/sitemap.xml` — the `<loc>`
- `src/lib/version.ts` — `APP_URL`

`node scripts/seo-probe.mjs` checks all of these against one constant, so it will tell you
if you miss one.

---

## Upgrading the Pix2Text OCR model

### What ships today

| | |
| --- | --- |
| Model | `Brian314/pix2text-mfr-quantized` (an ONNX export of `breezedeus/pix2text-mfr`) |
| Architecture | `VisionEncoderDecoderModel` — DeiT encoder + TrOCR-style decoder |
| Input | RGB, stretch-resized to **384×384**, scaled `/255` then `(x-0.5)/0.5` |
| Vocab | ~1,200 tokens, ByteLevel BPE |
| Generation | greedy, `decoder_start_token_id: 2`, `eos_token_id: 2`, cap 512 new tokens |
| Files | `public/models/pix2text-mfr-quantized/` — `config.json`, `generation_config.json`, `preprocessor_config.json`, `tokenizer.json`, `onnx/encoder_model.onnx` (23 MB), `onnx/decoder_model.onnx` (30 MB), `onnx/decoder_model_int8.onnx` (8 MB) |
| Exported with | transformers 4.37.0 |

The engine is `src/lib/pix2text.ts`, which drives onnxruntime-web directly rather than
going through transformers.js. The reason is in the file header: the bundled decoder has
no KV-cache branch, so transformers.js's VisionEncoderDecoder path cannot bind its inputs.
Driving ORT directly avoids that contract entirely — at the cost of the recipe above being
hardcoded, which is what the checklist below is for.

### Swapping in a new model

Upstream has since published **`breezedeus/pix2text-mfr-1.5`** (July 2025), which is a
useful worked example because it is *almost* drop-in and the differences are exactly the
kind that fail silently:

| | shipped (`pix2text-mfr`) | upstream 1.5 |
| --- | --- | --- |
| Architecture | `VisionEncoderDecoderModel`, DeiT + TrOCR | same |
| Image size / normalisation | 384×384, mean 0.5, std 0.5 | same |
| ONNX layout | `onnx/encoder_model.onnx`, `onnx/decoder_model.onnx` | **repo root**, no `onnx/` folder |
| Encoder size | 23 MB | **87.5 MB** |
| `decoder_start_token_id` | 2 | **1** |
| `eos_token_id` | 2 | 2 |
| Vocab | 1,200 | **1,868** |
| `max_new_tokens` | 512 | **1024** |
| Exported with | transformers 4.37.0 | transformers 4.52.3 |

Note what that table means in practice: the preprocessing is identical, so an upgrade
would run without throwing and produce **garbage from the first token**, because the
decoder would be started on the wrong id and detokenised against the wrong vocab. There is
no error to catch. Verified against the published configs on 2026-08-08.

The steps:

1. **Get the files.** Either an upstream repo that already ships ONNX (1.5 does), or
   produce your own with `optimum-cli export onnx --model <repo> <outdir>`.
2. **Drop it in** `public/models/<new-name>/`, and either keep the `onnx/` subfolder layout
   or update the paths at `src/lib/pix2text.ts:603` and `:660`.
3. **Point the app at it** — `defaultModelPath()` at `src/lib/pix2text.ts:87`.
4. **Reconcile every recipe constant** at `src/lib/pix2text.ts:96-101` against the new
   configs. This is the step that matters:
   - `IMAGE_SIZE` ← `preprocessor_config.json → size`
   - `DECODER_START_TOKEN_ID`, `EOS_TOKEN_ID`, `MAX_NEW_TOKENS` ← `generation_config.json`
   - `NUM_SPECIAL_IDS` ← `special_tokens_map.json`
   - the `(x-0.5)/0.5` normalisation in `preprocess()` ← `image_mean` / `image_std`
5. **Ship the matching `tokenizer.json`.** A vocab-size change makes the old one produce
   confident nonsense rather than an error.
6. **Check the decoder's input signature.** If the new export has `use_cache_branch` or
   `past_key_values.*` inputs, the greedy loop in `generate()` must feed them or the
   session will refuse to run. That is the one genuinely invasive change.
7. **Quantize if you want the smaller decoder** (`onnxruntime.quantization`, int8 dynamic)
   and keep the fp32 file: `DECODER_CANDIDATES` at `src/lib/pix2text.ts:603` prefers int8
   and falls back automatically.
8. **Verify on real images** — printed, handwritten, a matrix, a multi-line derivation —
   and read the LaTeX. No probe in `scripts/` can tell you the output is *correct*.

Weigh the cost: 1.5's encoder is 87.5 MB against the current 23 MB, which nearly triples
the offline download for accuracy that should be measured on your own images first.

### Keeping both

`Pix2TextLoadOpts.modelPath` is per-call, so a newer model can be added alongside the
bundled one and selected at runtime rather than replacing it. Given the constant drift
above, that is the safer shape for an upgrade: ship both, compare on real inputs, then
switch the default.

---

## Stack

React 19 · TypeScript · Vite 7 · Tailwind 4 · KaTeX (rendering) · MathLive (visual
editing) · temml (MathML) · onnxruntime-web + Pix2Text MFR (local OCR) · WebLLM and
wllama (in-browser chat models) · JSZip · Playwright (verification probes).

---

## Privacy

100% client-side. There is no Mathorium server. API keys, images, results and chat history
live in your browser's `localStorage`; local OCR runs in WebAssembly on your own CPU. Only
cloud providers you explicitly select ever receive a request. No analytics, no tracking.

> The persisted `localStorage` keys are still prefixed `mathforge.` after the rename. That
> is deliberate: they hold users' API keys and history, and renaming them would orphan
> that data rather than migrate it.

---

## License

MIT — free for personal and commercial use.

## Developer

**Samir Uddin Ahmed** — full-stack AI engineer

---

**Mathorium 9.0 © 2026** · Free · Open · Private · Installable PWA
