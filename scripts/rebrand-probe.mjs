/**
 * Rebrand probe — v9.0, MathForge → Mathorium.
 *
 * A rename is the kind of change that greps clean and still ships wrong: the old
 * name survives in a template literal, or one component keeps its own hardcoded
 * version and the header disagrees with the About dialog. v8.3 shipped exactly
 * that — four different version numbers in one build.
 *
 * So this checks the rendered UI, not the source. Every surface that states the
 * name or the version is read out of the running app and compared against the
 * single constant in `src/lib/version.ts`.
 *
 * The one thing that must NOT be renamed is also asserted: the `mathforge.*`
 * localStorage keys. They hold the user's API keys and history, and renaming them
 * would not migrate that data — it would orphan it.
 *
 *   node scripts/rebrand-probe.mjs
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "!! FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
};

// The declared truth. Everything else is compared against these.
const vsrc = readFileSync(resolve(root, "src/lib/version.ts"), "utf8");
const NAME = (vsrc.match(/APP_NAME\s*=\s*"([^"]+)"/) || [])[1];
const VERSION = (vsrc.match(/APP_VERSION\s*=\s*"([^"]+)"/) || [])[1];
const BUILD = (vsrc.match(/APP_BUILD\s*=\s*"([^"]+)"/) || [])[1];

console.log(`\n=== the declared version (src/lib/version.ts) ===`);
check(NAME === "Mathorium", "the app is named Mathorium", NAME);
check(VERSION === "9.0" && BUILD === "9.0.0", "the release is 9.0", `${VERSION} / ${BUILD}`);

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
check(pkg.version === BUILD, "package.json agrees with version.ts", `${pkg.version} vs ${BUILD}`);
check(pkg.name === "mathorium", "the package is renamed", pkg.name);

console.log("\n=== the old name is gone from the shipped bundle ===");
const html = readFileSync(resolve(dist, "index.html"), "utf8");
// Case-sensitive: the lowercase `mathforge.` storage keys are deliberate and
// checked separately below.
const stale = (html.match(/MathForge/g) || []).length;
check(stale === 0, "no MathForge in the shipped app", `${stale} occurrences`);

const manifest = JSON.parse(readFileSync(resolve(dist, "manifest.json"), "utf8"));
check(manifest.short_name === NAME, "the manifest is branded", manifest.short_name);
check(manifest.version === BUILD, "the manifest carries the release version", manifest.version);
const sw = readFileSync(resolve(dist, "sw.js"), "utf8");
// A cache name that survives a release serves the previous build to everyone who
// already installed the PWA, which is the classic "my deploy did nothing" bug.
check(sw.includes(`mathorium-v${VERSION}-cache`), "the service worker cache name is release-scoped", (sw.match(/CACHE_NAME = "([^"]+)"/) || [])[1]);

console.log("\n=== the keys holding user data were NOT renamed ===");
const storage = readFileSync(resolve(root, "src/lib/storage.ts"), "utf8");
check(/STORAGE_KEY = "mathforge\.state\.v4"/.test(storage), "the state key is untouched, so existing users keep their API keys");
check(html.includes("mathforge.schema"), "the schema key is untouched, so no user is treated as first-run");

console.log("\n=== every surface that states the name or version ===");
{
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => localStorage.setItem("mathforge.schema", "24"));
  await page.goto("file:///" + resolve(dist, "index.html").replace(/\\/g, "/"));
  await page.waitForSelector("header", { timeout: 30000 });

  check((await page.title()).includes(NAME), "the document title", await page.title());

  // The first-run tour is modal and states the version, so it is checked here
  // rather than dismissed blind — and it has to go before anything can be clicked.
  const welcome = page.locator("text=/Welcome to /").first();
  if (await welcome.count()) {
    const text = (await welcome.innerText()).replace(/\s+/g, " ");
    check(text.includes(`${NAME} v${VERSION}`), "the first-run welcome", text);
    check(await page.locator('svg[viewBox="0 0 512 512"]').first().isVisible(), "the welcome shows the mark, not a placeholder letter");
    await page.getByRole("button", { name: /^Skip$/ }).click();
    await page.waitForTimeout(250);
  } else {
    check(false, "the first-run welcome is shown on a fresh profile");
  }

  // innerText reports text as rendered, and both the header badge and the sidebar
  // footer are uppercased by CSS — so compare case-insensitively rather than
  // asserting against a casing the user never sees.
  const header = (await page.locator("header").first().innerText()).replace(/\s+/g, " ");
  check(header.includes(NAME), "the header wordmark", header.slice(0, 40));
  check(header.toLowerCase().includes(`v${VERSION}`), "the header version badge", (header.match(/[vV][\d.]+/) || ["none"])[0]);

  const sidebar = (await page.locator("text=/100% client-side/").first().innerText().catch(() => "")).replace(/\s+/g, " ");
  check(sidebar.toLowerCase().includes(`v${VERSION}`), "the sidebar footer version", sidebar || "none");

  for (const [tab, want, label] of [
    ["settings", new RegExp(`Settings · v${VERSION.replace(".", "\\.")}`), "the Settings heading"],
    ["about", new RegExp(`${NAME}\\s*v?${VERSION.replace(".", "\\.")}`), "the About heading"],
  ]) {
    await page.getByRole("button", { name: new RegExp(tab, "i") }).first().click();
    await page.waitForTimeout(350);
    const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    check(want.test(text), label, (text.match(want) || ["not found"])[0]);
  }

  // Still on About: the build number and the footer line.
  const about = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  check(about.includes(`build ${BUILD}`), "the About build number", `build ${BUILD}`);
  check(!/v8 Pro|MathForge/.test(about), "no stale v8 branding on About");

  await page.getByRole("button", { name: /chat/i }).first().click();
  await page.waitForTimeout(400);
  const chat = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  check(/Mathorium Assistant/.test(chat) || /Image Generation/.test(chat), "the chat empty state", chat.slice(0, 60));

  const real = errors.filter((e) => !/relative paths to specify assets/i.test(e) && !/puter is not defined/i.test(e));
  check(real.length === 0, "no page errors", real.slice(0, 2).join(" | "));
  await browser.close();
}

console.log(`\n${failures ? `!! ${failures} FAILURE(S)` : "ALL CHECKS PASSED"}`);
process.exit(failures ? 1 : 0);
