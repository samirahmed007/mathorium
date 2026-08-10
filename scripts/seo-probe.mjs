/**
 * SEO probe.
 *
 * The app is client-rendered and inlined into a single 17 MB document, which is
 * the worst possible starting point for search: what a crawler fetches is
 * whatever sits in the HTML *before* the bundle runs. So the assertions here are
 * about the shipped artifact rather than the running app — the head Google
 * parses, the copy it reads instead of an empty div, and the fact that the
 * scrapers' absolute-URL requirements are actually met.
 *
 * The one behavioural check that matters: the boot shell must disappear when
 * React mounts. If `createRoot` ever stops clearing its container, the shell
 * would sit permanently under the app — visible duplicate content, and a bug the
 * head-only checks could never catch.
 *
 *   node scripts/seo-probe.mjs
 */
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const SITE = "https://mathorium.vercel.app";

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "!! FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
};

const html = readFileSync(resolve(dist, "index.html"), "utf8");
// The 16 MB inlined bundle is the only large thing in here, so both regions of
// interest are defined relative to it: the head is everything before it, the
// shell is the body markup up to wherever it sits.
const bundleAt = html.search(/<script type="module"[^>]*>/);
const head = html.slice(0, html.indexOf("</head>") + 7);
const bodyAt = html.indexOf("<body");
const shell = html.slice(bodyAt, bundleAt > bodyAt ? bundleAt : html.lastIndexOf("</body>"));
const unescape = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

const meta = (sel) => {
  const re = new RegExp(`<meta[^>]+(?:name|property)="${sel}"[^>]+content="([^"]*)"`, "i");
  const alt = new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:name|property)="${sel}"`, "i");
  return (head.match(re) || head.match(alt) || [])[1] ?? "";
};

console.log("\n=== the head a crawler parses ===");

// Entity-decoded, because `&amp;` is one character to a SERP and five to a regex.
const title = unescape((head.match(/<title>([^<]*)<\/title>/) || [])[1] ?? "");
check(title.length > 0 && title.length <= 65, "the title fits a SERP without truncation", `${title.length} chars: ${title}`);
// Nobody searches for a name they have not heard, so the job has to come first.
check(/math ocr|latex/i.test(title.split("—")[1] ?? title), "the title leads with the job, not just the brand", title);

const desc = meta("description");
check(desc.length >= 110 && desc.length <= 165, "the description is a usable SERP snippet length", `${desc.length} chars`);
check(/mathpix/i.test(desc), "the description names the competitor people actually search for");
check(/free/i.test(desc) && /no api key|no account/i.test(desc), "the description states the differentiator (free, keyless)");

check(new RegExp(`<link rel="canonical" href="${SITE}/?"`).test(head), "a canonical URL is declared", (head.match(/rel="canonical" href="([^"]+)"/) || [])[1]);
check(/max-image-preview:large/.test(meta("robots")), "large image previews are opted into", meta("robots"));

console.log("\n=== link previews ===");
for (const [tag, want] of [
  ["og:type", /website/],
  ["og:site_name", /Mathorium/],
  ["og:url", new RegExp(SITE)],
  ["og:title", /Mathorium/],
  ["og:description", /.{80,}/],
  ["og:image:width", /^1200$/],
  ["og:image:height", /^630$/],
  ["og:image:alt", /.{20,}/],
  ["twitter:card", /summary_large_image/],
  ["twitter:image", new RegExp(SITE)],
]) {
  check(want.test(meta(tag.replace(/:/g, "\\:"))), `${tag} is set correctly`, meta(tag.replace(/:/g, "\\:")).slice(0, 60));
}
// A relative og:image is silently dropped by every scraper.
check(meta("og\\:image").startsWith("https://"), "og:image is absolute, as scrapers require", meta("og\\:image"));
check(existsSync(resolve(dist, "og.png")), "the card image ships with the site");

console.log("\n=== structured data ===");
const ld = (html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1] ?? "";
let graph = null;
try { graph = JSON.parse(ld)["@graph"]; } catch { /* reported next */ }
check(Array.isArray(graph), "the JSON-LD block parses", graph ? `${graph.length} nodes` : ld.slice(0, 60));
const byType = Object.fromEntries((graph ?? []).map((n) => [n["@type"], n]));
check(!!byType.SoftwareApplication, "the app is described as a SoftwareApplication");
check(byType.SoftwareApplication?.offers?.price === "0" && byType.SoftwareApplication?.isAccessibleForFree === true, "it is declared free, which is the whole pitch");
check(byType.SoftwareApplication?.image?.startsWith("https://"), "the entity carries an absolute image");
check(!!byType.FAQPage && (byType.FAQPage.mainEntity ?? []).length >= 4, "an FAQ is marked up", `${(byType.FAQPage?.mainEntity ?? []).length} questions`);
// Every marked-up answer must exist in the visible copy — schema that describes
// content the page does not show is exactly what manual actions are for.
const faqOnPage = (byType.FAQPage?.mainEntity ?? []).filter((q) => {
  const key = q.name.replace(/[^a-z]+/gi, " ").trim().split(" ").slice(0, 3).join(" ");
  return new RegExp(key.split(" ").join("[^<]*"), "i").test(shell);
});
check(faqOnPage.length >= 3, "the marked-up FAQ is answered in visible copy, not invented", `${faqOnPage.length}/${(byType.FAQPage?.mainEntity ?? []).length} matched`);
check(!byType.SoftwareApplication?.aggregateRating, "no fabricated review rating is claimed");

console.log("\n=== crawlable copy ===");
const shellText = shell.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
check(shellText.length > 400, "the pre-render ships real copy, not an empty div", `${shellText.length} chars`);
for (const phrase of ["Mathpix alternative", "LaTeX", "MathML", "handwriting", "offline", "free"]) {
  check(new RegExp(phrase, "i").test(shellText), `the copy covers "${phrase}"`);
}
check(/<h1[^>]*>/.test(shell), "there is exactly one H1", `${(shell.match(/<h1/g) || []).length} found`);
check((shell.match(/<h1/g) || []).length === 1, "…and only one");
check(/<noscript>/.test(html.slice(0, bundleAt)), "a noscript fallback explains the app");
check(/alt="[^"]{6,}"/.test(shell), "the logo image has descriptive alt text");
// Googlebot truncates an HTML response at 15 MB. The bundle is 16 MB, so if it
// ever drifts back in front of the markup, everything above is fetched by nobody.
const CUTOFF = 15 * 1024 * 1024;
check(bundleAt > bodyAt && bundleAt < CUTOFF && html.indexOf("</dl>") < CUTOFF,
  "the crawlable payload lands before Googlebot's 15 MB truncation",
  `shell ends at ${(html.indexOf("</dl>") / 1024).toFixed(0)} KB, bundle starts at ${(bundleAt / 1024).toFixed(0)} KB`);

console.log("\n=== files search engines fetch by convention ===");
for (const f of ["robots.txt", "sitemap.xml"]) {
  check(existsSync(resolve(dist, f)), `${f} is deployed`);
}
const robots = existsSync(resolve(dist, "robots.txt")) ? readFileSync(resolve(dist, "robots.txt"), "utf8") : "";
check(/^Sitemap:\s*https:\/\//m.test(robots), "robots.txt points at the sitemap with an absolute URL");
check(/Disallow:\s*\/models\//.test(robots), "the 22 MB weights are kept out of the crawl budget");
check(!/^Disallow:\s*\/\s*$/m.test(robots), "the site itself is not accidentally disallowed");
const sitemap = existsSync(resolve(dist, "sitemap.xml")) ? readFileSync(resolve(dist, "sitemap.xml"), "utf8") : "";
check(sitemap.includes(`<loc>${SITE}/</loc>`), "the sitemap lists the canonical URL");
check((sitemap.match(/<loc>/g) || []).length === 1, "…and nothing non-canonical alongside it", `${(sitemap.match(/<loc>/g) || []).length} urls`);

console.log("\n=== the shell hands over to the app ===");
{
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => localStorage.setItem("mathforge.schema", "24"));

  // Before the bundle runs, the shell is what a visitor (and a crawler that does
  // not execute JS) sees.
  await page.goto("file:///" + resolve(dist, "index.html").replace(/\\/g, "/"), { waitUntil: "commit" });
  check(await page.locator("#mtr-boot").count() > 0, "the boot shell is in the document from the first byte");

  await page.waitForSelector("header", { timeout: 30000 });
  await page.waitForTimeout(500);
  check(await page.locator("#mtr-boot").count() === 0, "React clears the shell on mount — no duplicate copy under the app");
  check(await page.locator("header").isVisible(), "the app is what remains");
  check(await page.title() === title, "the title survives the handover", await page.title());

  const real = errors.filter((e) => !/relative paths to specify assets/i.test(e) && !/puter is not defined/i.test(e));
  check(real.length === 0, "no page errors", real.slice(0, 2).join(" | "));
  await browser.close();
}

console.log(`\n${failures ? `!! ${failures} FAILURE(S)` : "ALL CHECKS PASSED"}`);
process.exit(failures ? 1 : 0);
