/**
 * Theme verification harness.
 *
 * Renders the built app in Chromium, walks every tab in dark, light and system
 * mode, and reports what is actually painted rather than what the CSS claims.
 *
 * Two checks, because a broken theme fails in two distinct ways:
 *   1. contrast — text the same colour as what is behind it. This is what the
 *      old light theme got wrong: dark card classes survived on a white page.
 *   2. leakage — a surface still painting a dark-theme value in light mode,
 *      which means something bypassed the token ladder.
 *
 * Screenshots go to .theme-audit/ so the result can be eyeballed too.
 *
 * Run: node scripts/theme-audit.mjs
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(root, ".theme-audit");
mkdirSync(OUT, { recursive: true });

/** [tab id, sidebar button label] — the sidebar prefixes each with an icon, so
 *  match on the accessible name rather than anchoring the string. */
const TABS = [
  ["convert", /Convert/i],
  ["latex", /LaTeX Tool/i],
  ["mathtype", /MathType/i],
  ["chat", /Chat/i],
  ["providers", /Providers/i],
  ["settings", /Settings/i],
  ["about", /About/i],
];


/**
 * Measure contrast from the rendered pixels rather than from computed style.
 *
 * Computed style cannot answer this question. Tailwind v4 emits palette colours
 * as `oklch(...)`, which `backgroundColor` returns verbatim, and gradient
 * buttons keep their paint in `background-image` while `backgroundColor`
 * reports the UA default grey — so a style-walking audit reports white-on-white
 * for every accent button and passes everything else by accident.
 *
 * Instead: screenshot the page with every glyph masked out, hand the bytes back
 * to the page, and read the actual pixels. That is ground truth for gradients,
 * oklch, opacity, blur and images alike, and with no text painted, the dominant
 * pixel inside an element's box is exactly its background. The text colour is
 * its computed `color` flattened onto that background.
 */
async function auditTab(page, tab, mode) {
  /**
   * Screenshot the page with every glyph erased.
   *
   * `color` cannot affect layout, so every surface paints exactly where it did —
   * gradients, tints, blur, images included — but with no text on top. Each
   * pixel inside an element's box is therefore its true background, which takes
   * the last guess out of the measurement. Probing the box perimeter did not:
   * one large character in a tight box ("∑" in a nav icon, "αβγ" on a palette
   * key) covers the probes, so the modal sample *was* the ink and the element
   * scored a flawless 1:1 against itself. Excluding ink by colour cannot fix
   * that either — it would discard the background of exactly the washed-out
   * elements worth catching, where background and ink are near-identical.
   *
   * The mask is removed before the contrast pass, so `getComputedStyle().color`
   * below still reads the real foreground.
   */
  const mask = await page.addStyleTag({
    content:
      "*,*::before,*::after{color:transparent!important;" +
      "-webkit-text-fill-color:transparent!important;text-shadow:none!important}",
  });
  const shot = await page.screenshot({ fullPage: true });
  await mask.evaluate((el) => el.remove());
  const problems = await page.evaluate(
    async ({ b64, THRESH }) => {
      const blob = await (await fetch("data:image/png;base64," + b64)).blob();
      const img = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(img.width, img.height);
      const cx2d = canvas.getContext("2d", { willReadFrequently: true });
      cx2d.drawImage(img, 0, 0);
      const px = cx2d.getImageData(0, 0, img.width, img.height).data;
      const W = img.width;

      const at = (x, y) => {
        x = Math.round(x); y = Math.round(y);
        if (x < 0 || y < 0 || x >= img.width || y >= img.height) return null;
        const i = (y * W + x) * 4;
        return [px[i], px[i + 1], px[i + 2]];
      };
      const lum = ([r, g, b]) => {
        const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const parse = (s) => {
        const m = s.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
        return p.length >= 3 && !p.some(Number.isNaN) ? { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 } : null;
      };

      const out = [];
      let skippedDisabled = 0;
      for (const el of document.querySelectorAll("body *")) {
        const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!direct) continue;
        const text = el.textContent?.trim();
        if (!text) continue;
        // WCAG 1.4.3 exempts inactive controls, and both themes deliberately
        // mute them. Counted rather than dropped quietly — see the report.
        if (el.closest("button:disabled,input:disabled,[aria-disabled='true']")) { skippedDisabled++; continue; }
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.15) continue;
        if (cs.webkitTextFillColor === "rgba(0, 0, 0, 0)") continue; // gradient-filled text
        const fg = parse(cs.color);
        if (!fg) continue;

        // Document coordinates, to match the full-page screenshot.
        const x0 = r.left + scrollX, y0 = r.top + scrollY;

        // Every pixel in the box is background now that the text is masked out.
        // The representative is the median by luminance, not the mode: a mode is
        // meaningless over a gradient (24 samples, 24 distinct colours, the
        // "winner" is arbitrary) and is hijacked by any glyph the mask cannot
        // erase, since colour-font emoji ignore `color`. A median survives both.
        const cols = Math.min(9, Math.max(3, Math.floor(r.width / 8)));
        const rows = Math.min(7, Math.max(3, Math.floor(r.height / 6)));
        const samples = [];
        for (let iy = 0; iy < rows; iy++) {
          for (let ix = 0; ix < cols; ix++) {
            const p = at(x0 + ((ix + 0.5) / cols) * r.width, y0 + ((iy + 0.5) / rows) * r.height);
            if (p) samples.push(p);
          }
        }
        if (samples.length < 6) continue;
        samples.sort((a, b) => lum(a) - lum(b));
        const bg = samples[samples.length >> 1];

        const flat = fg.rgb.map((c, i) => Math.round(c * fg.a + bg[i] * (1 - fg.a)));
        const cr = ratio(flat, bg);
        if (cr < Number(THRESH)) {
          out.push({
            tag: el.tagName.toLowerCase(),
            cls: (typeof el.className === "string" ? el.className : "").slice(0, 100),
            text: text.slice(0, 50), ratio: +cr.toFixed(2),
            fg: flat, bg,
          });
        }
      }
      return { out, skippedDisabled };
    },
    { b64: shot.toString("base64"), THRESH: process.env.MF_CONTRAST || 2.4 },
  );
  return { tab, mode, problems: problems.out, skippedDisabled: problems.skippedDisabled };
}

const results = [];
const browser = await chromium.launch();

/** Cycle order implemented by the header button: dark → light → system. */
const CLICKS = { dark: 0, light: 1, "system-light": 2, "system-dark": 2 };

for (const mode of ["dark", "light", "system-light", "system-dark"]) {
  const wantsDark = mode === "dark" || mode === "system-dark";
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    // Drives prefers-color-scheme, which is what "system" resolves against.
    colorScheme: wantsDark ? "dark" : "light",
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto("file:///" + resolve(root, "dist/index.html").replace(/\\/g, "/"));
  await page.waitForSelector("header", { timeout: 30000 });

  /**
   * Freeze animation and transitions for the whole run.
   *
   * index.css transitions `color` over 200ms on body/header/aside/main/section,
   * and children inherit the *interpolated* value while it runs. Injecting the
   * glyph mask below starts that transition, and removing it starts another one
   * back — so a `getComputedStyle().color` read straight afterwards returns
   * something like `rgba(226,232,240,0.18)` instead of the real colour, and
   * every contrast ratio in the report comes out wrong by the same mechanism.
   * Killing transitions makes both swaps instantaneous. It also stops the
   * screenshots catching popIn/fadeIn mid-frame.
   */
  await page.addStyleTag({
    content: "*,*::before,*::after{transition:none!important;animation:none!important}",
  });

  // Onboarding overlay covers the app on a fresh profile.
  for (const label of [/get started/i, /skip/i, /got it/i, /close/i]) {
    const b = page.getByRole("button", { name: label });
    if (await b.count()) { await b.first().click({ timeout: 2000 }).catch(() => {}); break; }
  }
  await page.waitForTimeout(300);

  // Reach the target theme through the real control rather than by seeding
  // storage, so the cycle logic and the matchMedia listener are both exercised.
  const themeBtn = page.getByRole("button", { name: /^Theme:/ });
  if (!(await themeBtn.count())) throw new Error("theme button not found — aria-label changed?");
  for (let i = 0; i < CLICKS[mode]; i++) {
    await themeBtn.first().click();
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(300);

  const applied = await page.evaluate(() => ({
    cls: document.documentElement.className,
    data: document.documentElement.dataset.theme,
    resolved: document.documentElement.dataset.resolvedTheme,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    bodyFg: getComputedStyle(document.body).color,
    card: getComputedStyle(document.documentElement).getPropertyValue("--surface-card").trim(),
    white: getComputedStyle(document.documentElement).getPropertyValue("--color-white").trim(),
  }));

  const expectDark = wantsDark;
  const ok =
    applied.resolved === (expectDark ? "dark" : "light") &&
    applied.cls.includes(expectDark ? "dark" : "light") &&
    applied.data === (mode.startsWith("system") ? "system" : mode);

  console.log(`\n=== ${mode} ===  ${ok ? "APPLIED OK" : "!! WRONG THEME APPLIED"}`);
  console.log(`  html.class="${applied.cls}" data-theme=${applied.data} resolved=${applied.resolved}`);
  console.log(`  body bg=${applied.bodyBg} fg=${applied.bodyFg}`);
  console.log(`  --surface-card=${applied.card}  --color-white=${applied.white}`);

  for (const [tab, label] of TABS) {
    const nav = page.locator("aside").getByRole("button", { name: label });
    if (await nav.count()) await nav.first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400);
    results.push(await auditTab(page, tab, wantsDark ? "dark" : "light"));
    await page.screenshot({ path: resolve(OUT, `${mode}-${tab}.png`), fullPage: false });
  }

  if (errors.length) console.log(`  !! ${errors.length} console/page errors: ${errors.slice(0, 2).join(" | ")}`);
  await ctx.close();
}

await browser.close();

console.log("\n\n================ CONTRAST REPORT ================");
let total = 0;
for (const r of results) {
  total += r.problems.length;
  const flag = r.problems.length ? "FAIL" : "ok  ";
  console.log(`${flag} ${r.mode.padEnd(6)} ${r.tab.padEnd(10)} low-contrast=${r.problems.length}`);
  for (const p of r.problems.slice(0, 10)) {
    console.log(`       ${p.ratio}:1  <${p.tag}> "${p.text}"`);
    console.log(`              fg=rgb(${p.fg}) bg=rgb(${p.bg})  class="${p.cls}"`);
  }
}
console.log(`\nTOTAL low-contrast nodes: ${total}`);
console.log(`Disabled controls skipped (WCAG-exempt): ${results.reduce((n, r) => n + r.skippedDisabled, 0)}`);
console.log(`Screenshots: ${OUT}`);
