/**
 * Brand probe.
 *
 * The mark is defined once in `components/Brand` and rasterised from
 * `public/icon.svg`, and the whole point of that arrangement is that the icon a
 * user sees on their home screen is the same shape as the one in the header. That
 * only holds if the references actually resolve: a `<link rel="icon">` pointing at
 * a file the build forgot to copy fails silently — the browser just shows a blank
 * page glyph and nobody notices for a release.
 *
 * So this checks both halves: that every icon the document and the manifest
 * reference exists in `dist/`, and that the mark renders (and survives a theme
 * switch) in each place it is used.
 *
 *   node scripts/brand-probe.mjs
 */
import { chromium } from "playwright";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const URL_ = "file:///" + resolve(dist, "index.html").replace(/\\/g, "/");

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "!! FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ── the files the page and the manifest promise ────────────────────────────
console.log("\n=== assets ===");

const html = readFileSync(resolve(dist, "index.html"), "utf8").slice(0, 8000);
const headRefs = [...html.matchAll(/<link[^>]+href="\.\/([^"]+)"/g)].map((m) => m[1]);
check(headRefs.includes("icon.svg"), "the document declares the SVG favicon", headRefs.join(" "));
check(headRefs.includes("apple-touch-icon.png"), "an Apple touch icon is declared (iOS ignores SVG)");
check(headRefs.includes("manifest.json"), "the web app manifest is declared");

for (const ref of headRefs) {
  check(existsSync(resolve(dist, ref)), `${ref} exists in dist/`);
}

let manifest = null;
try { manifest = JSON.parse(readFileSync(resolve(dist, "manifest.json"), "utf8")); } catch (e) { /* reported below */ }
check(!!manifest, "the manifest is valid JSON");
check(manifest?.name?.startsWith("Mathorium") && manifest?.short_name === "Mathorium", "the manifest is branded Mathorium", `${manifest?.short_name} / ${manifest?.name}`);
check(manifest?.version === "9.0.0", "the manifest carries the release version", manifest?.version);

const iconSrcs = [...(manifest?.icons ?? []), ...(manifest?.shortcuts ?? []).flatMap((s) => s.icons ?? [])].map((i) => i.src);
check(iconSrcs.length >= 5, `the manifest offers a full icon set`, `${iconSrcs.length} entries`);
for (const src of [...new Set(iconSrcs)]) {
  const p = resolve(dist, src.replace(/^\.\//, ""));
  check(existsSync(p) && statSync(p).size > 200, `manifest icon ${src} exists and is not empty`, existsSync(p) ? `${statSync(p).size} B` : "missing");
}
// Android draws maskable icons edge-to-edge and crops them; an "any" icon
// submitted as maskable gets its rounded corners shaved into a lopsided shape.
check(
  (manifest?.icons ?? []).some((i) => i.purpose === "maskable") && !(manifest?.icons ?? []).some((i) => /any maskable/.test(i.purpose ?? "")),
  "maskable icons are their own entries, not dual-purpose",
);
check(
  existsSync(resolve(dist, "og.png")) && statSync(resolve(dist, "og.png")).size > 10_000,
  "the social card is present for link previews",
);

// ── the mark, where it is used ─────────────────────────────────────────────
const browser = await chromium.launch();

for (const mode of ["dark", "light"]) {
  console.log(`\n=== ${mode} ===`);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.addInitScript(() => {
    localStorage.setItem("mathforge.schema", "24");
    localStorage.setItem("mathforge.state.v4", JSON.stringify({
      conversations: [{
        id: "brand", title: "Brand", createdAt: 1, updatedAt: 2,
        messages: [
          { id: "u", role: "user", content: "hello", createdAt: 1 },
          { id: "a", role: "assistant", content: "Hi.", createdAt: 2 },
        ],
      }],
      activeConversationId: "brand",
    }));
  });

  await page.goto(URL_);
  await page.waitForSelector("header", { timeout: 30000 });
  for (const label of [/get started/i, /skip/i, /got it/i, /close/i]) {
    const b = page.getByRole("button", { name: label });
    if (await b.count()) { await b.first().click({ timeout: 2000 }).catch(() => {}); break; }
  }
  if (mode === "light") {
    await page.getByRole("button", { name: /^Theme:/ }).first().click();
    await page.waitForTimeout(300);
  }

  const MARK = 'svg[viewBox="0 0 512 512"]';
  const header = page.locator("header").locator(MARK).first();
  check(await header.waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false), "the header wears the mark");
  const size = await header.boundingBox();
  check(!!size && Math.round(size.width) === 36 && Math.round(size.height) === 36, "at the size it was asked for", `${size?.width}×${size?.height}`);

  // The tile is a solid accent surface, so it must NOT follow the theme — the
  // same reasoning as `.text-on-accent`. A light-mode variant would be a second
  // logo to keep in sync with the app icon, which cannot have one.
  const painted = await header.evaluate((svg) => {
    const rects = [...svg.querySelectorAll("rect")];
    const stops = [...svg.querySelectorAll("stop")].map((s) => s.getAttribute("stop-color"));
    return { fill: rects[0]?.getAttribute("fill") ?? "", stops };
  });
  check(/^url\(#/.test(painted.fill), "the tile is painted by its own gradient", painted.fill);
  check(painted.stops.includes("#8b5cf6") && painted.stops.includes("#38bdf8"), "brand colours are literal, so the theme cannot recolour the logo", painted.stops.join(" "));

  // Two marks on one page must not share gradient ids: they would both resolve
  // to whichever <defs> came first, and unmounting that one strips the gradient
  // from the other.
  await page.locator("aside").getByRole("button", { name: /About/i }).first().click();
  const aboutMark = page.locator("main").locator(MARK).first();
  check(await aboutMark.waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false), "the About page wears the mark");
  const ids = await page.locator(MARK).evaluateAll((svgs) => svgs.map((s) => s.querySelector("linearGradient")?.id ?? ""));
  check(ids.length >= 2 && new Set(ids).size === ids.length, "each mark owns its gradient ids", ids.join(" "));

  await page.locator("aside").getByRole("button", { name: /Chat/i }).first().click();
  await page.waitForTimeout(400);
  const avatar = page.locator("main").locator(MARK).first();
  check(await avatar.waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false), "the assistant's avatar is the mark, not an emoji");

  // The mark has to survive being drawn at 16px — that is the favicon and the
  // avatar. Rendering it tiny and counting distinct colours catches a shape that
  // collapses to a violet blob.
  const legible = await page.evaluate(() => {
    const svg = document.querySelector('svg[viewBox="0 0 512 512"]').cloneNode(true);
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;left:0;top:0;z-index:99999";
    box.appendChild(svg);
    document.body.appendChild(box);
    return new Promise((done) => {
      const img = new Image();
      const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = c.height = 16;
        const g = c.getContext("2d");
        g.drawImage(img, 0, 0, 16, 16);
        const d = g.getImageData(0, 0, 16, 16).data;
        let white = 0, cyan = 0, violet = 0;
        for (let i = 0; i < d.length; i += 4) {
          const [r, gg, b] = [d[i], d[i + 1], d[i + 2]];
          if (r > 210 && gg > 210 && b > 210) white++;
          else if (b > 150 && gg > 140 && r < 140) cyan++;
          else if (b > 120 && r > 60 && r < 170) violet++;
        }
        box.remove();
        URL.revokeObjectURL(url);
        done({ white, cyan, violet });
      };
      img.onerror = () => { box.remove(); done({ white: 0, cyan: 0, violet: 0 }); };
      img.src = url;
    });
  });
  check(legible.white > 20 && legible.violet > 60, "the monogram still reads at favicon size", JSON.stringify(legible));

  const real = errors.filter((e) => !/relative paths to specify assets/i.test(e) && !/puter is not defined/i.test(e));
  check(real.length === 0, "no page errors", real.slice(0, 2).join(" | "));
  await page.screenshot({ path: resolve(root, ".theme-audit", `brand-${mode}.png`) });
  await ctx.close();
}

// ── deep links, which the manifest shortcuts depend on ─────────────────────
console.log("\n=== deep links ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("mathforge.schema", "24"));
  await page.goto(URL_ + "?tab=chat");
  await page.waitForSelector("header", { timeout: 30000 });
  for (const label of [/get started/i, /skip/i, /got it/i, /close/i]) {
    const b = page.getByRole("button", { name: label });
    if (await b.count()) { await b.first().click({ timeout: 2000 }).catch(() => {}); break; }
  }
  check(
    await page.locator("textarea").first().waitFor({ state: "visible", timeout: 10000 }).then(() => true, () => false),
    "?tab=chat opens Chat, so the manifest shortcuts land somewhere",
  );
  await page.locator("aside").getByRole("button", { name: /Providers/i }).first().click();
  await page.waitForTimeout(300);
  check(/tab=providers/.test(page.url()), "switching tabs updates the URL, so a tab can be shared", page.url().split("/").pop());
  await ctx.close();
}

await browser.close();
console.log(`\n${failures ? `!! ${failures} FAILURE(S)` : "ALL CHECKS PASSED"}`);
process.exit(failures ? 1 : 0);
