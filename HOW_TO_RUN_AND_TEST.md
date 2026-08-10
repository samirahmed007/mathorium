# Mathorium 9.0 — Running, Testing and Distributing

Mathorium is a **100% client-side** app. There is no server, no backend, no account and
no build step at run time. Everything below is either "open a file" or "serve a folder".

Deployment to Vercel — first deploy, redeploy, rollback, delete, and moving to a new
hostname — is in [README.md → Deploying to Vercel](README.md#deploying-to-vercel).

---

## 1. Run the app

### Option A — from the `dist/` folder (what you ship)

Build once, then serve the folder:

```bash
cd f:/advanced-math-ai-web-application/mathforge
npm install                 # first time only
npm run build               # writes dist/
npx vite preview --port 4173
```

Open <http://localhost:4173>. That's it — everything works, including offline OCR.

Any static server works just as well; pick whichever you already have:

```bash
npx serve dist              # Node
npx http-server dist -p 4173
python -m http.server 4173 -d dist    # Python
```

### Option B — just double-click `dist/index.html`

Works, with one limitation. The whole UI is inlined into that single file, so the
editors, chat, exports and cloud conversion all run straight off the disk. But browsers
refuse `fetch()` over `file://`, so the app **cannot load the local Pix2Text model** —
offline OCR is unavailable and the app will say so. Set **Settings → Conversion engine →
Cloud only** in that mode, or serve the folder over HTTP (Option A) to get local OCR.

### Option C — development, with hot reload

```bash
npm run dev                 # http://localhost:5173
```

### What `npm run build` produces

| Path | Size | What it is | Needed? |
| --- | --- | --- | --- |
| `dist/index.html` | ~17 MB | The entire app — all JS, CSS, fonts inlined | **Yes** |
| `dist/models/` | ~58 MB | Bundled Pix2Text MFR ONNX model | Only for offline OCR |
| `dist/ort/` | ~31 MB | onnxruntime-web WASM binaries | Only for offline OCR |
| `dist/manifest.json`, `dist/sw.js` | ~5 KB | PWA install + offline cache | Only for "Install app" |
| `dist/robots.txt`, `dist/sitemap.xml`, `dist/og.png` | ~90 KB | Search and link previews | Only when hosted publicly |

Total ~107 MB with the model, or a single 17 MB file without it.

The build enforces one invariant: `src/lib/version.ts` must agree with `package.json`.
If they drift, the build fails rather than shipping a UI that states two different
versions — which is exactly what v8.3 did in four different places.

### Python environment

The `.venv/` here is only for offline verification of the ONNX model (`onnxruntime`,
`numpy`, `pillow`). **The app needs no Python and no backend.** You never activate it to
use Mathorium.

---

## 2. Testing

There is no unit-test suite. Each feature has a **probe** instead: a Playwright script
that loads the built `dist/index.html` in a real browser, drives the actual UI, and
asserts on what renders. This catches the failure that unit tests miss — code that
compiles, typechecks, and does nothing when clicked.

```bash
npm run build                     # probes read dist/, so build first

node scripts/theme-audit.mjs      # contrast, 4 theme modes × 7 tabs
node scripts/rebrand-probe.mjs    # name + version on every surface stating one
node scripts/seo-probe.mjs        # head, JSON-LD, crawlable shell, robots, sitemap
node scripts/brand-probe.mjs      # the mark in header/About/avatar, icon set, deep links
node scripts/markdown-probe.mjs   # chat content rendering, incl. mid-stream
node scripts/snip-probe.mjs       # screen snip: delay, repeat, crop
node scripts/voice-probe.mjs      # voice input, incl. the blocked-microphone path
node scripts/imagegen-probe.mjs   # image generation and engine listing
node scripts/mathfield-probe.mjs  # the visual equation editor
```

Each prints `PASS` / `!! FAIL` per check and exits non-zero on any failure, so they drop
into CI unchanged. First run downloads a Chromium build via `npx playwright install
chromium`.

Two console errors are expected under `file://` and are filtered by every probe: the
`Can't use relative paths to specify assets` warning, and `puter is not defined` (the
Puter SDK is a remote script that is not present offline).

### Manual verification the probes cannot do

A probe asserts that a control exists, is legible and responds. It cannot judge whether an
OCR result is *correct*. Before shipping a change to the conversion path, convert a handful
of real images — printed, handwritten, a matrix, a multi-line derivation — and read the
LaTeX. A wrong recipe constant produces confident, plausible, wrong output; nothing
automated here will notice.

---

## 3. Distribute it so anyone can use it, with no installation

Pick the row that matches what your users need. None of these ask the user to install
anything — no Node, no Python, no extension.

| # | You send / host | User does | Offline OCR | Internet needed |
| --- | --- | --- | --- | --- |
| 1 | The single file `dist/index.html` | Double-click it | ✗ | Only for cloud AI |
| 2 | `dist/` on any static web host | Opens a URL | ✓ | To load the page |
| 3 | `dist/` on a LAN/intranet server | Opens a URL | ✓ | No (LAN only) |

### 1. One file, by email or USB stick — the simplest thing that works

Copy `dist/index.html` anywhere and open it. 17 MB, no folder structure, no server, no
install. Everything works except offline OCR and PWA install (see Option B above).
Best for: sending the LaTeX / MathType editors and the exporters to someone.

### 2. Any static host — full app, nothing to install

Upload the **contents of `dist/`** (keeping the folder layout) to any static host and give
people the URL. Free options that need no server admin:

- **Vercel** — the configured target; see [README.md](README.md#deploying-to-vercel).
- **Netlify Drop** — drag the `dist` folder onto <https://app.netlify.com/drop>.
- **Cloudflare Pages** — point at the repo, build `npm run build`, publish `dist`.
- **GitHub Pages** — push the contents of `dist/` to a `gh-pages` branch.
- **Any web space you already have** — IIS, nginx, Apache: copy `dist/` into the web root.

Sub-paths work (`https://you.github.io/mathorium/`): the model and WASM are loaded
relative to the page, not from the domain root.

Two host-side notes:

- Serve `.onnx` and `.wasm` as binary and do not let a proxy rewrite them. Most hosts do
  this correctly with no configuration.
- 58 MB of model files exceeds some free tiers' per-file or total limits. If the host
  rejects them, upload only `index.html` (and skip offline OCR), or use option 3.

### 3. LAN / air-gapped — full app, no internet at all

Copy `dist/` onto one machine on the network and serve it there:

```bash
npx serve dist -l 4173      # or: python -m http.server 4173 -d dist
```

Everyone else opens `http://<that-machine-ip>:4173`. Offline OCR runs in each user's own
browser, on their own CPU — the serving machine only hands out files. Nothing leaves the
LAN. This is the setup for classrooms, labs and secure environments.

### Then: let users install it as an app

Served over HTTP/HTTPS (options 2 and 3), Mathorium is an installable PWA. Chrome or Edge
shows an install icon in the address bar; after that it opens in its own window and keeps
working with the network off. Nothing is installed in the OS sense — it is still the same
browser page.

The service worker caches under a release-scoped name (`mathorium-v9.0-cache-v1`), so
bumping `APP_VERSION` in `src/lib/version.ts` is what makes installed users pick up a new
build. Ship a change without bumping it and returning PWA users keep the old bundle.

### What never leaves the user's machine

API keys, images, conversion results and chat history live in that browser's
`localStorage`. There is no Mathorium server to send them to. Local OCR runs entirely in
WebAssembly on the user's CPU. Only cloud providers the user explicitly selects ever
receive a network request.

