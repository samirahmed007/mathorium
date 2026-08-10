# Changelog

Notable changes per release. Versions before 9.0 shipped under the name **MathForge**.

---

## 9.0 — 2026-08-08

The rename release: **MathForge → Mathorium**. The old name collided with existing
products, which made the app unfindable. Most of the work in 9.0 went into things that
were quietly broken rather than into the rename itself.

### Added

- **Live model lists.** Every provider fetches its own catalogue from its `/models`
  endpoint, and each model is classified vision-capable or free from what the provider
  reports. The previous hand-maintained list went stale whenever a provider shipped
  anything.
- **Screen snip in Convert** — capture a screen region with an optional delay or on
  repeat, crop it, and send it straight to the conversion queue.
- **Image generation across the free providers,** with per-provider image models listed
  live, plus a Perchance handoff.
- **Local GGUF models from the Providers tab,** matching what Settings already offered.
- **Rebuilt chat content rendering** — tables, callouts, footnotes, task lists, per-block
  copy, and maths that renders mid-stream without reflowing the message.
- **A crawlable landing shell.** The app is a single inlined 17 MB document, so crawlers
  previously received an empty `<div>`. It now ships a real shell — H1, positioning copy,
  feature list, FAQ — inside `#root`, which React's first commit replaces. Backed by
  JSON-LD (`SoftwareApplication`, `FAQPage`), Open Graph and Twitter cards, `robots.txt`
  and a single-URL `sitemap.xml`.
- **A new mark and full icon set,** defined once in `src/components/Brand.tsx` and
  rasterised from `public/icon.svg` by `scripts/make-icons.mjs` so the icons cannot drift
  from the in-app logo. Includes proper full-bleed maskable variants and a 1200×630 OG
  card.
- **`?tab=` deep links,** so a tool can be bookmarked or shared and the PWA manifest's
  shortcuts resolve.
- **Verification probes** for every feature (`scripts/*.mjs`) — Playwright scripts that
  drive the built artifact and assert on what actually renders.

### Fixed

- **Light and System themes,** rebuilt from the token layer up; the light theme was
  unusable in places. Verified at zero low-contrast nodes across all four theme modes and
  seven tabs.
- **Voice input** works, and names the specific reason when a browser refuses the
  microphone instead of failing silently.
- **The CORS proxy** falls back silently when a provider blocks browser calls, and can be
  stopped from Settings. The manual prefix is documented with working examples.
- **Googlebot truncation.** Vite emits its module script into `<head>`, so inlining 16 MB
  of JavaScript there pushed `<body>` past byte 16 M — beyond Googlebot's 15 MB fetch
  limit, which meant every crawlable byte was fetched by nobody. The build now moves the
  inlined bundle to the end of `<body>`; the shell also paints at the start of the
  download rather than the end.
- **Version drift.** v8.3 shipped four different version numbers in one build — header,
  sidebar, About and Settings all disagreed. There is now a single `src/lib/version.ts`,
  and the build fails if it disagrees with `package.json`.
- **The first-run welcome** shows the actual mark instead of a placeholder letter.

### Changed

- `package.json` renamed `mathforge-v8` → `mathorium`; version 8.3.0 → 9.0.0.
- Service worker cache is release-scoped (`mathorium-v9.0-cache-v1`), so bumping
  `APP_VERSION` is what invalidates it for installed PWA users.
- Download filenames, export headers and referer headers carry the new name.
- `vercel.json` added: security headers, immutable caching for the content-addressed model
  weights, `must-revalidate` for `/` (a stale inlined `index.html` is a stale app).
- Documentation rewritten — README, HOW_TO_RUN_AND_TEST, and a new APP_DESCRIPTION.md.
  The README now documents the Vercel deploy/redeploy/rollback/delete cycle and how to
  upgrade the Pix2Text model.

### Not changed, deliberately

- **The `mathforge.*` `localStorage` keys.** They hold users' API keys, providers and chat
  history. Renaming them would not migrate that data, it would orphan it — every existing
  user would open 9.0 to a factory-fresh app. The prefix is invisible to users and the
  cost of changing it is unbounded, so it stays.
- **The bundled OCR model.** Upstream `pix2text-mfr-1.5` exists, but its encoder is 87.5 MB
  against the current 23 MB and several of its recipe constants differ in ways that fail
  silently rather than loudly. See the upgrade checklist in the README.
- **No `aggregateRating` in the structured data.** There is no review corpus to point at,
  and inventing one is a manual-action risk.

---

## 8.x and earlier (as MathForge)

- **8.3** — live thinking panel for reasoning models; syntax-highlighted code blocks; one
  `+` menu in the composer; MathType palette shortcuts and selection wrapping.
- **8.2** — MathType promoted from dialog to a standalone tab with the source image beside
  the editor; smart paste of MathML/LaTeX/rendered maths; offline OCR from any sub-path.
- **8.1** — live agentic workflow trace in the chat panel.
- **8.0** — Agent Mode (plan → solve → audit → correct); visual equation editor; undo/redo;
  local GGUF models via llama.cpp in WebAssembly.
- **7.x** — offline Pix2Text OCR; MathML matrix alignment on export; replies that continue
  past the token cap; keyless free providers with LLM7 as the default.
- **4.0** — provider auto-rotation; command palette; toasts; PWA; onboarding tour.
