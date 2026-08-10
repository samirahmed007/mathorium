/**
 * MathType editor probe.
 *
 * The <math-field> is the one surface the theme cannot reach through Tailwind:
 * it is built imperatively and styled through inline properties and MathLive's
 * own custom properties, some of which are consumed inside its shadow DOM. That
 * makes it the place where a `var()` can silently fail to resolve — as the
 * `border` shorthand did, falling back to `currentColor` and drawing a bright
 * white outline in dark mode.
 *
 * So this checks the field by selecting a real expression and reading the
 * painted pixels: what colour the selection highlight actually is, and whether
 * the glyphs on top of it stay legible.
 *
 * Run: node scripts/mathfield-probe.mjs
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(root, ".theme-audit");
mkdirSync(OUT, { recursive: true });

const lum = ([r, g, b]) => {
  const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const browser = await chromium.launch();

for (const mode of ["dark", "light"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto("file:///" + resolve(root, "dist/index.html").replace(/\\/g, "/"));
  await page.waitForSelector("header", { timeout: 30000 });
  await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation:none!important}" });

  for (const label of [/get started/i, /skip/i, /got it/i, /close/i]) {
    const b = page.getByRole("button", { name: label });
    if (await b.count()) { await b.first().click({ timeout: 2000 }).catch(() => {}); break; }
  }
  if (mode === "light") {
    await page.getByRole("button", { name: /^Theme:/ }).first().click();
    await page.waitForTimeout(250);
  }

  await page.locator("aside").getByRole("button", { name: /MathType/i }).first().click();
  await page.waitForSelector("math-field", { timeout: 20000 });
  await page.waitForTimeout(1200); // MathLive lays out asynchronously

  // Select the whole expression through MathLive's own API, which is what the
  // "select first to wrap it" palette workflow relies on.
  await page.evaluate(() => {
    const mf = document.querySelector("math-field");
    mf.focus();
    mf.executeCommand("selectAll");
  });
  await page.waitForTimeout(400);

  const box = await page.locator("math-field").boundingBox();
  await page.screenshot({ path: resolve(OUT, `mathfield-${mode}.png`), clip: box });

  const declared = await page.evaluate(() => {
    const mf = document.querySelector("math-field");
    const cs = getComputedStyle(mf);
    return {
      border: cs.borderColor,
      bg: cs.backgroundColor,
      fg: cs.color,
      selBg: cs.getPropertyValue("--selection-background-color").trim(),
      selFg: cs.getPropertyValue("--selection-color").trim(),
      caret: cs.getPropertyValue("--caret-color").trim(),
    };
  });

  // Read the painted selection: the most common colour inside the field that is
  // not the field's own background is the highlight.
  const shot = await page.screenshot({ clip: box });
  const painted = await page.evaluate(async ({ b64 }) => {
    const blob = await (await fetch("data:image/png;base64," + b64)).blob();
    const img = await createImageBitmap(blob);
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    const tally = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const k = `${d[i]},${d[i + 1]},${d[i + 2]}`;
      tally.set(k, (tally.get(k) || 0) + 1);
    }
    return [...tally.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k, n]) => ({ rgb: k.split(",").map(Number), pct: +((n / (img.width * img.height)) * 100).toFixed(1) }));
  }, { b64: shot.toString("base64") });

  console.log(`\n=== ${mode} ===`);
  console.log(`  border=${declared.border}  bg=${declared.bg}  fg=${declared.fg}`);
  console.log(`  --selection-background-color=${declared.selBg}  --selection-color=${declared.selFg}`);
  console.log(`  --caret-color=${declared.caret}`);
  console.log(`  dominant painted colours (field area):`);
  for (const p of painted) console.log(`     rgb(${p.rgb})  ${p.pct}%`);

  // The two that matter: highlight vs field, and glyph vs highlight.
  const field = painted[0].rgb;
  const hl = painted.find((p) => p.rgb.join() !== field.join());
  if (hl) {
    console.log(`  highlight vs field : ${ratio(hl.rgb, field).toFixed(2)}:1  ${ratio(hl.rgb, field) < 1.25 ? "!! INVISIBLE" : "visible"}`);
  } else {
    console.log(`  !! no second colour found — selection is not painting at all`);
  }
  await ctx.close();
}

await browser.close();
console.log(`\nScreenshots: ${OUT}\\mathfield-{dark,light}.png`);
