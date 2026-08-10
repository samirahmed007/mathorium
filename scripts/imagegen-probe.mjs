/**
 * Image-generation probe.
 *
 * Two jobs, and the first is the reason this exists: image generation is the one
 * feature whose backends are keyless public services, which means they change
 * without notice and a model list written from documentation goes stale silently.
 * The UI cannot tell the difference between "this engine is gone" and "the user
 * typed a bad prompt", so the catalogue is checked against the live services here
 * instead of being trusted.
 *
 *   node scripts/imagegen-probe.mjs --live   engine reachability, no app needed
 *   node scripts/imagegen-probe.mjs          the app's Generate Image UI in dist/
 *
 * A --live failure is a change at the provider, not a regression in this repo.
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = process.argv.includes("--live");

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "!! FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
};
const note = (label, detail) => console.log(`  ..   ${label}${detail ? `  — ${detail}` : ""}`);

/**
 * `isVisible()` in Playwright answers about *this instant* — the `timeout` option
 * it accepts does not make it wait. Anything that appears in response to a click
 * has to be awaited explicitly or the assertion races the render.
 */
const visible = (locator, timeout = 5000) =>
  locator.waitFor({ state: "visible", timeout }).then(() => true, () => false);

const browser = await chromium.launch();

if (LIVE) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // A real page origin, so the services see a browser request rather than curl —
  // some of them vary their answer on Origin/Referer.
  await page.goto("https://example.com");

  console.log("\n=== Pollinations (keyless, direct <img> URL) ===");
  const poll = await page.evaluate(async () => {
    const out = {};
    try {
      const r = await fetch("https://image.pollinations.ai/models");
      out.models = await r.json();
    } catch (e) { out.modelsErr = String(e); }
    try {
      const u = "https://image.pollinations.ai/prompt/" + encodeURIComponent("a red cube") +
        "?width=512&height=512&seed=7&model=sana&nologo=true";
      const r = await fetch(u);
      const b = await r.blob();
      out.gen = { status: r.status, type: b.type, size: b.size };
    } catch (e) { out.genErr = String(e); }
    return out;
  });
  check(Array.isArray(poll.models) && poll.models.length > 0, "models endpoint lists engines", JSON.stringify(poll.models ?? poll.modelsErr));
  check(poll.gen?.status === 200 && poll.gen.type.startsWith("image/") && poll.gen.size > 1024,
    "keyless text-to-image renders (CORS-readable)", JSON.stringify(poll.gen ?? poll.genErr));

  console.log("\n=== Puter (SDK, free tier) ===");
  const puter = await page.evaluate(async () => {
    try {
      await new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = "https://js.puter.com/v2/";
        s.onload = res;
        s.onerror = () => rej(new Error("SDK script failed to load"));
        document.head.appendChild(s);
      });
    } catch (e) { return { err: String(e) }; }
    for (let i = 0; i < 80 && !window.puter?.ai?.txt2img; i++) await new Promise((r) => setTimeout(r, 250));
    const ai = window.puter?.ai;
    if (!ai) return { err: "window.puter.ai never appeared" };
    if (typeof ai.txt2img !== "function") return { keys: Object.keys(ai), txt2img: false };
    try {
      const r = await Promise.race([
        ai.txt2img("a small red cube on a white background"),
        new Promise((_, rej) => setTimeout(() => rej(new Error("no answer in 90s")), 90000)),
      ]);
      const src = r?.src ?? String(r ?? "");
      return { txt2img: true, ok: true, tag: r?.tagName ?? typeof r, head: String(src).slice(0, 64), len: String(src).length };
    } catch (e) {
      return { txt2img: true, ok: false, err: String(e?.message || e).slice(0, 240) };
    }
  });
  if (puter.txt2img && puter.ok) {
    check(puter.len > 1024, "puter.ai.txt2img returns an image", `${puter.tag}, ${puter.len} B, ${puter.head}`);
  } else {
    // Not a repo failure: Puter gates txt2img behind a signed-in account, and a
    // fresh automated browser has none. Recorded so the catalogue's "needs
    // sign-in" wording stays honest rather than guessed.
    note("puter.ai.txt2img needs an account in this context", puter.err || JSON.stringify(puter));
  }

  console.log("\n=== Perchance (ai-text-to-image-generator) ===");
  const perchance = await page.evaluate(async () => {
    const out = {};
    try {
      const r = await fetch("https://image-generation.perchance.org/api/checkVerificationStatus?userKey=x&channel=ai-text-to-image-generator&__cacheBust=1");
      out.status = r.status;
      out.body = (await r.text()).slice(0, 120);
    } catch (e) { out.err = String(e).slice(0, 200); }
    return out;
  });
  // Expected to fail: the endpoint sends no Access-Control-Allow-Origin, so the
  // browser refuses to read it from any origin but perchance.org. This asserts
  // the *reason* the app cannot call it directly, so if Perchance ever opens CORS
  // this check flips and tells us the integration is now possible.
  check(!!perchance.err, "generate API is CORS-blocked from other origins (expected)", perchance.err || `status=${perchance.status} body=${perchance.body}`);

  await ctx.close();
  await browser.close();
  console.log(`\n${failures ? `!! ${failures} FAILURE(S)` : "ALL LIVE CHECKS PASSED"}`);
  process.exit(failures ? 1 : 0);
}

// --------------------------------------------------------------------------
// UI pass: the Generate Image surface in the built app.
//
// Provider-supplied engines only exist after a live model fetch, which needs the
// user's API key. Rather than leave half the feature unverified, the persisted
// state is seeded with what such a fetch would have written: one provider holding
// a chat model and an image model, with no key saved. That drives the real
// compiled discovery path — grouping by provider, the needs-a-key gate, and the
// chat picker's exclusion of models that draw instead of answering.
// --------------------------------------------------------------------------
const URL = "file:///" + resolve(root, "dist/index.html").replace(/\\/g, "/");

const SEED = {
  id: "seeded-co",
  name: "Seeded Co",
  baseUrl: "https://seeded.example/v1",
  chatPath: "/chat/completions",
  authScheme: "bearer",
  apiKey: "",
  kind: "openai",
  free: false,
  models: [
    { id: "seed-chat-1", label: "Seed Chat 1", vision: false, free: true },
    { id: "seed-flux-1", label: "Seed FLUX 1 (image gen)", vision: false, free: true, imageGen: true },
  ],
};

for (const mode of ["dark", "light"]) {
  console.log(`\n=== ${mode} ===`);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // Seeded before the app's first render, so the store loads it as persisted state.
  // The schema stamp matters as much as the provider: without it the store treats
  // this as a first run and throws the seed away (`store.tsx` → `migrateIfNeeded`).
  await page.addInitScript((seed) => {
    localStorage.setItem("mathforge.schema", "24");
    const KEY = "mathforge.state.v4";
    let s = {};
    try { s = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { s = {}; }
    s.providers = [...(s.providers || []).filter((p) => p.id !== seed.id), seed];
    localStorage.setItem(KEY, JSON.stringify(s));
  }, SEED);

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

  // The chat model picker must not offer an engine that answers with a picture.
  const chatOptions = await page.locator("select").last().locator("option").allTextContents().catch(() => []);
  check(
    !chatOptions.some((t) => /image gen/i.test(t)),
    "chat model picker excludes image-generation models",
    chatOptions.length ? `${chatOptions.length} options` : "no chat select found",
  );

  // Enter image mode through the composer's + menu, the way a user does.
  await page.locator("button[title*='attach' i], button[title*='more' i], button[title*='add' i]").first().click();
  await page.waitForSelector("[data-popover]", { timeout: 5000 });
  await page.locator("[data-popover]").last().getByText(/Generate an image/i).first().click();
  await page.waitForTimeout(300);
  check(await visible(page.getByText(/^Image$/).first()), "image mode opens");

  // The engine picker: grouped, with the built-ins and the seeded provider's model.
  // Found by what it contains, not by position — the header's provider and model
  // pickers are also <select>s and sit ahead of it in the document.
  const engineSel = page.locator("select").filter({ has: page.locator("option[value='sana']") }).first();
  await engineSel.waitFor({ state: "visible", timeout: 10000 });
  const groups = await engineSel.locator("optgroup").evaluateAll((els) => els.map((e) => e.label));
  const options = await engineSel.locator("option").evaluateAll((els) =>
    els.map((e) => ({ text: e.textContent.trim(), value: e.value, disabled: e.disabled })),
  );
  check(groups.includes("Pollinations"), "keyless built-in engine is grouped under its provider", groups.join(", "));
  check(options.some((o) => o.value === "sana" && !o.disabled), "Sana is offered and selectable");
  const seeded = options.find((o) => o.value === `${SEED.id}::seed-flux-1`);
  check(!!seeded, "provider's image model is discovered and listed", seeded?.text);
  check(
    !!seeded?.disabled && /needs API key/i.test(seeded.text),
    "an engine with no key saved is listed but disabled, with the reason",
    seeded ? `disabled=${seeded.disabled} "${seeded.text}"` : "",
  );
  check(
    !options.some((o) => o.value === "seed-chat-1"),
    "chat-only models are not offered as image engines",
  );

  // Perchance cannot be embedded (no CORS, Cloudflare-gated key, sameorigin
  // framing — see the --live pass), so the feature is a hand-off. It has to be
  // offered, and it has to say what it did.
  const perchanceBtn = page.locator("button", { hasText: /Perchance/i }).first();
  check(await visible(perchanceBtn), "Perchance hand-off is offered");
  // The new tab is a real popup; without a handler Playwright leaves it open and
  // the context close below blocks on it.
  const popup = page.waitForEvent("popup", { timeout: 8000 }).catch(() => null);
  await perchanceBtn.click();
  const opened = await popup;
  check(
    !!opened && /perchance\.org\/ai-text-to-image-generator/.test(opened.url()),
    "hand-off opens the generator itself",
    opened?.url() ?? "no popup",
  );
  await opened?.close().catch(() => {});
  check(await visible(page.getByText(/Opened Perchance/i).first()), "Perchance hand-off explains itself in a toast");
  check(
    await visible(page.getByText(/paste it into the box|copy your prompt across by hand/i).first()),
    "the toast says what to do with the prompt",
  );

  await page.screenshot({ path: resolve(root, ".theme-audit", `imagegen-${mode}.png`) });

  const real = errors.filter((e) => !/relative paths to specify assets/i.test(e));
  check(real.length === 0, "no page errors", real.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
console.log(`\n${failures ? `!! ${failures} FAILURE(S)` : "ALL CHECKS PASSED"}`);
process.exit(failures ? 1 : 0);
