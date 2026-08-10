# App descriptions

Ready-to-paste copy for the places Mathorium gets listed. Keep these in sync with
`index.html` (the meta description and JSON-LD) and `public/manifest.json` — the SEO probe
checks the ones that ship, but nothing checks a directory listing except a human.

The positioning is the same everywhere: **the open Mathpix alternative — free, keyless,
runs in your browser**. That is the phrase people search for, and it is the one claim that
is both true and differentiating.

---

## One line (≤60 chars)

> Free AI math OCR — image to LaTeX, MathML and Word.

## Short (≤160 chars — meta description, app stores, Product Hunt tagline)

> Free AI math OCR in your browser. Convert images, handwriting and PDF screenshots to
> LaTeX, MathML or Word — no API key, no upload. The open Mathpix alternative.

## Medium (~400 chars — directory listings, GitHub About, social bio)

> Mathorium turns a picture of an equation into clean LaTeX, MathML or Word — from a
> textbook photo, a PDF screenshot, a whiteboard or your own handwriting. Recognition runs
> on-device with the bundled Pix2Text model, so there is no API key, no account, no page
> quota and nothing uploaded. Batch hundreds of images, edit the result in a visual
> equation editor, and export to nine formats. Free and open.

## Long (store listing / landing page)

> **Mathorium — free AI math OCR, LaTeX and MathML studio**
>
> Mathorium converts mathematics in images into text you can actually use. Point it at a
> textbook photo, a PDF screenshot, a whiteboard, a scanned paper or your own handwriting,
> and it produces clean single-line LaTeX and presentation MathML.
>
> **It is genuinely free.** Recognition runs in your browser using the bundled Pix2Text
> MFR model — no API key, no account, no page quota, no subscription, and no image ever
> leaves your device. Cloud AI models are optional, and only used if you choose one.
>
> **What it does**
>
> - **Convert** — image → LaTeX / MathML, in expression, line-by-line or mixed text+maths
>   mode. Batch 500+ images with auto-retry. Snip a region of your screen straight into the
>   queue, with delayed and repeat capture.
> - **Equation editor** — a full visual editor with 20 palette groups and ~350 symbols,
>   visual and LaTeX panes side by side, and the source image beside them so you can check
>   the OCR against the original.
> - **Math chat** — ask about a problem and get answers with live-rendered maths, an
>   agentic plan → solve → audit → correct workflow, and a thinking panel for reasoning
>   models. Free keyless providers included; bring your own key if you prefer.
> - **Export** — LaTeX, MathML, Word-ready OMML, Markdown, HTML, CSV, JSON, plain text, or
>   a self-contained ZIP.
> - **Offline** — install it as an app and OCR, rendering and the editor keep working with
>   no network at all.
>
> **Private by construction.** There is no Mathorium server. API keys, images, results and
> chat history live in your browser's local storage; OCR runs in WebAssembly on your own
> CPU. No analytics, no tracking.
>
> Free and open source, MIT licensed. Built by Samir Uddin Ahmed.

---

## Keywords this copy targets

Ranked by intent, not volume. The first group is what the app should win on, because the
copy substantiates it; the rest are supporting.

**Primary** — free Mathpix alternative · Mathpix alternative free · math OCR free ·
image to LaTeX · handwriting to LaTeX · equation to LaTeX converter

**Secondary** — LaTeX OCR · MathML converter · screenshot to LaTeX · PDF math to LaTeX ·
math to Word equation · offline math OCR · browser math OCR · no API key math OCR

**Long tail** — convert handwritten equations to LaTeX free · extract equations from a PDF
screenshot · Pix2Text in the browser · free LaTeX OCR no signup

Note that no `<meta name="keywords">` tag ships. Google ignores it, and Bing treats a
stuffed one as a spam signal. Keywords earn their place by appearing in the visible copy —
which is why the boot shell in `index.html` reads the way it does.

---

## Social

**GitHub About** — use the medium description, plus topics:
`math-ocr` `latex` `mathml` `ocr` `mathpix-alternative` `onnx` `webassembly` `react`
`pwa` `offline-first` `pix2text` `katex` `mathlive`

**Post / Show HN framing** — lead with the constraint, not the feature list. The
interesting claim is that a 17 MB single-file web app does math OCR with no server and no
key, not that it exports nine formats.

> Mathorium: math OCR that runs entirely in your browser. Drop in a photo of an equation,
> get LaTeX. The model is bundled, so there is no API key, no upload and no quota — and it
> keeps working with the network off.
