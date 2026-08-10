/**
 * Rasterise the brand SVGs into the PNG icon set.
 *
 *   node scripts/make-icons.mjs
 *
 * Why a script instead of committing hand-made PNGs: the mark's geometry lives in
 * exactly two places (`src/components/Brand.tsx` and `public/icon.svg`), and every
 * raster here is derived from the second one. Redraw the mark, re-run this, and
 * the favicon, the PWA icons, the Apple touch icon and the social card all follow
 * — there is no path where the app icon and the in-app logo disagree.
 *
 * Why PNG at all, when SVG favicons work: iOS ignores SVG for `apple-touch-icon`,
 * Android's installer wants real bitmaps for the maskable entries, and no social
 * network renders SVG in a link preview. The SVG stays the source of truth and the
 * favicon's primary form; these are the fallbacks the platforms insist on.
 *
 * The outputs are committed. They are inputs to the deployed page, not build
 * artifacts of it, and generating them needs a browser and system fonts — neither
 * of which a deploy runner is guaranteed to have.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pub = (f) => resolve(root, "public", f);

/** [source svg, output png, width, height] */
const JOBS = [
  ["icon.svg", "icon-512.png", 512, 512],
  ["icon.svg", "icon-192.png", 192, 192],
  ["icon.svg", "apple-touch-icon.png", 180, 180],
  ["icon.svg", "favicon-32.png", 32, 32],
  ["icon-maskable.svg", "icon-maskable-512.png", 512, 512],
  ["icon-maskable.svg", "icon-maskable-192.png", 192, 192],
  ["og.svg", "og.png", 1200, 630],
];

const browser = await chromium.launch();

for (const [src, out, w, h] of JOBS) {
  const svg = readFileSync(pub(src), "utf8");
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  // A transparent page, and the SVG stretched to fill it exactly: the screenshot
  // is then the icon, with no letterboxing to crop off afterwards.
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:transparent">
       <div style="width:${w}px;height:${h}px">${svg.replace(/width="\d+"\s+height="\d+"/, `width="${w}" height="${h}"`)}</div>
     </body></html>`,
    { waitUntil: "load" },
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: pub(out), omitBackground: true });
  await page.close();
  console.log(`  ✓ ${out.padEnd(26)} ${w}×${h}  ← ${src}`);
}

await browser.close();
console.log(`\n${JOBS.length} icon(s) written to public/`);
