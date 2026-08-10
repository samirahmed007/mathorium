/**
 * Voice input probe.
 *
 * The Web Speech API's recogniser is a browser service, not page code, so
 * headless Chromium cannot be made to transcribe real speech. What *can* be
 * driven is everything the app does around it: the mic chip's enabled/blocked
 * states, the language picker (15 entries, choice persists, running session
 * cycles), the live status strip when a session actually opens, and the two
 * failure surfaces — a warning toast when the browser has no recogniser at all,
 * and an error toast when the recogniser reports a failure after start.
 *
 * Run: node scripts/voice-probe.mjs
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const URL = "file:///" + resolve(root, "dist/index.html").replace(/\\/g, "/");

const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "!! FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
};

async function openChat(page, mode) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(URL);
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
  await page.locator("aside").getByRole("button", { name: /Chat/i }).first().click();
  await page.waitForSelector("textarea", { timeout: 20000 });
  await page.waitForTimeout(300);
  return errors;
}

for (const mode of ["dark", "light"]) {
  console.log(`\n=== ${mode} ===`);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = await openChat(page, mode);

  // The mic chip sits in the composer toolbar above the textarea.
  const chip = page.locator("button[title^='Dictate']");
  check((await chip.count()) === 1, "mic chip present in the composer", "");
  check(!(await chip.locator("svg").first().getAttribute("class") ?? "").includes("opacity-40"), "mic icon enabled (recogniser exists)");

  // 1. Language picker: 15 entries, click persists to localStorage, button shows base tag.
  const langButton = chip.locator("xpath=following-sibling::button[1]");
  check((await langButton.textContent()).trim() === "en", "button shows the current language's base tag", `"${(await langButton.textContent()).trim()}"`);
  await langButton.click();
  await page.waitForSelector("[data-popover]", { timeout: 5000 });
  const list = page.locator("[data-popover]").last();
  const items = await list.locator("button").count();
  check(items === 15, "language list has 15 entries", `${items}`);
  await list.getByText("हिन्दी", { exact: true }).click();
  await page.waitForTimeout(200);
  check((await langButton.textContent()).trim() === "hi", "picking a language updates the button", `"${(await langButton.textContent()).trim()}"`);
  const stored = await page.evaluate(() => localStorage.getItem("mf-voice-lang"));
  check(stored === "hi-IN", "language choice persisted to localStorage", `mf-voice-lang=${stored}`);
  await page.evaluate(() => localStorage.removeItem("mf-voice-lang"));

  // 2. Start dictation. Fake device + fake UI mean start() should open a session;
  // if the recogniser service is unavailable headless it must *report* that via
  // the error toast instead of dying silently. Either is correct behaviour here.
  await chip.click();
  const strip = page.locator("text=/Waiting for speech|Listening/");
  const toast = page.locator("text=Voice input").last();
  const outcome = await Promise.race([
    strip.first().waitFor({ timeout: 8000 }).then(() => "strip"),
    toast.waitFor({ timeout: 8000 }).then(() => "toast"),
  ]);
  check(outcome === "strip", "mic click opens a session with the live status strip", outcome === "strip" ? "" : `fell back to error toast: ${(await toast.textContent()).slice(0, 80)}`);
  if (outcome === "strip") {
    check(await strip.first().isVisible(), "status strip visible", "");
    const stopChip = page.locator("button[title^='Stop dictation']");
    check((await stopChip.count()) === 1, "chip flips to the stop state", "");
    await stopChip.click();
    await page.waitForTimeout(300);
    check((await page.locator("text=/Waiting for speech|Listening/").count()) === 0, "stop closes the session and hides the strip", "");
    check((await page.locator("button[title^='Dictate']").count()) === 1, "chip flips back to start", "");
  }

  const real = errors.filter((e) => !/relative paths to specify assets/i.test(e));
  check(real.length === 0, "no page errors", real.slice(0, 2).join(" | "));
  await ctx.close();
}

// 3. Blocked browser: no SpeechRecognition constructor at all. The chip must be
//    dimmed and clicking it must explain why, instead of doing nothing.
{
  console.log(`\n=== blocked (no recogniser) ===`);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
  });
  const errors = await openChat(page, "dark");
  const chip = page.locator("button[title^='Voice input unavailable']");
  check((await chip.count()) === 1, "chip present with an unavailable-state tooltip", "");
  const cls = await chip.locator("svg").first().getAttribute("class");
  check((cls ?? "").includes("opacity-40"), "mic icon dimmed when unavailable", cls);
  await chip.click();
  const toast = page.locator("text=Voice input unavailable").last();
  check(await toast.isVisible(), "clicking toasts the reason instead of a dead click", "");
  const real = errors.filter((e) => !/relative paths to specify assets/i.test(e));
  check(real.length === 0, "no page errors", real.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
console.log(`\n${failures ? `!! ${failures} FAILURE(S)` : "ALL CHECKS PASSED"}`);
process.exit(failures ? 1 : 0);
