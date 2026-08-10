/**
 * Screen-snip probe.
 *
 * The one part of this feature that cannot be driven headlessly is the browser's
 * own screen picker — it is chrome, not page content. Everything *after* it is
 * ours and is what can actually be wrong: waiting for the first decoded frame,
 * grabbing it at native resolution, mapping a selection drawn in display pixels
 * back onto source pixels, and handing the crop to the convert queue.
 *
 * So `getDisplayMedia` is replaced with a canvas-backed MediaStream carrying a
 * known layout — a red block top-right, a blue block bottom-left, text in the
 * middle. Cropping the red block and finding red pixels (and no blue) in the
 * queued image is what proves the coordinate mapping is right; an off-by-scale
 * error would queue the wrong region and show up immediately.
 *
 * Run: node scripts/snip-probe.mjs
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(root, ".theme-audit");
mkdirSync(OUT, { recursive: true });

const W = 1280, H = 720;
const RED = { x: 900, y: 100, w: 200, h: 100 };   // in source pixels
const BLUE = { x: 100, y: 500, w: 200, h: 100 };

const FAKE_DISPLAY_MEDIA = ({ W, H, RED, BLUE }) => {
  // A fresh stream per call, exactly like the real picker: the first scenario
  // ends its track with "Stop sharing", and handing the same dead track back
  // would make the second scenario fail for a reason that has nothing to do
  // with the app.
  navigator.mediaDevices.getDisplayMedia = async () => {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const draw = () => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(RED.x, RED.y, RED.w, RED.h);
      ctx.fillStyle = "#0000ff";
      ctx.fillRect(BLUE.x, BLUE.y, BLUE.w, BLUE.h);
      ctx.fillStyle = "#000000";
      ctx.font = "56px serif";
      ctx.fillText("E = mc^2", 420, 380);
    };
    draw();
    // captureStream(0) + requestFrame is deterministic: frames appear because we
    // push them, not because the compositor felt like running.
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const tick = setInterval(() => {
      if (track.readyState === "ended") return clearInterval(tick);
      draw();
      track.requestFrame?.();
    }, 80);
    window.__fakeDisplay = { stream, track };
    return stream;
  };
};

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "!! FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
};

for (const mode of ["dark", "light"]) {
  console.log(`\n=== ${mode} ===`);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(FAKE_DISPLAY_MEDIA, { W, H, RED, BLUE });
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

  await page.locator("aside").getByRole("button", { name: /Convert/i }).first().click();
  await page.waitForTimeout(300);

  check(await page.getByText("Screen snip").first().isVisible(), "snip panel renders on Convert tab");

  // Immediate capture: click the "none" delay, then start.
  await page.getByRole("button", { name: /^none$/ }).first().click();
  await page.getByRole("button", { name: /Start screen capture/i }).click();

  await page.waitForSelector("text=Crop the formula", { timeout: 15000 });
  check(true, "cropper opened after capture");
  check(
    await page.getByText(`${W}×${H}`).first().isVisible(),
    "frame grabbed at source resolution",
    `${W}×${H}`,
  );
  await page.screenshot({ path: resolve(OUT, `snip-cropper-${mode}.png`) });

  // Drag over the red block, in display coordinates.
  const img = page.locator(`img[alt^="Screen capture"]`);
  const box = await img.boundingBox();
  const k = box.width / W; // display px per source px
  const from = { x: box.x + (RED.x + 8) * k, y: box.y + (RED.y + 8) * k };
  const to = { x: box.x + (RED.x + RED.w - 8) * k, y: box.y + (RED.y + RED.h - 8) * k };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);

  const readout = await page.locator("text=/\\d+×\\d+ px/").first().textContent();
  const [selW, selH] = readout.match(/(\d+)×(\d+)/).slice(1).map(Number);
  check(
    Math.abs(selW - (RED.w - 16)) <= 6 && Math.abs(selH - (RED.h - 16)) <= 6,
    "selection maps display px → source px",
    `${readout.trim()} (expected ~${RED.w - 16}×${RED.h - 16})`,
  );

  await page.getByRole("button", { name: /Add crop/i }).click();
  // Wait for the effect, not for a guessed number of milliseconds: the crop
  // travels through toBlob → File → the tab's own compress() (FileReader plus an
  // image decode) before it can appear, and a fixed sleep made this probe report
  // failures that were only its own impatience.
  await page.waitForSelector('img[alt^="snip-"]', { timeout: 15000 }).catch(() => {});

  // One frame only, so accepting the crop closes the cropper.
  check(!(await page.getByText("Crop the formula").count()), "cropper closed after the last frame");

  const queued = page.locator(`img[alt^="snip-"]`);
  check((await queued.count()) > 0, "crop queued as a convert item");

  // Ground truth: the queued image must be the red block and nothing else.
  const pixels = await page.evaluate(async () => {
    const el = document.querySelector('img[alt^="snip-"]');
    if (!el) return null;
    const img = new Image();
    img.src = el.src;
    await img.decode();
    const c = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let red = 0, blue = 0, other = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) red++;
      else if (d[i + 2] > 200 && d[i] < 60 && d[i + 1] < 60) blue++;
      else other++;
    }
    const total = red + blue + other;
    return { w: c.width, h: c.height, red: +(red / total * 100).toFixed(1), blue: +(blue / total * 100).toFixed(1) };
  });
  check(pixels && pixels.red > 95, "cropped region is the selected block", pixels && `red=${pixels.red}% blue=${pixels.blue}%`);
  check(pixels && pixels.blue === 0, "no content from outside the selection", pixels && `blue=${pixels.blue}%`);
  // 184×84 source px is below the OCR floor, so it should have been scaled up.
  check(pixels && pixels.w > (RED.w - 16), "small crop upscaled for OCR", pixels && `${pixels.w}×${pixels.h} from ${RED.w - 16}×${RED.h - 16}`);

  // Sharing stays live for the next snip (keep-alive is the default), and the
  // countdown path arms and cancels cleanly.
  check(await page.getByRole("button", { name: /Stop sharing/i }).isVisible(), "sharing kept live for repeat snips");
  await page.getByRole("button", { name: /^5s$/ }).click();
  await page.getByRole("button", { name: /Snap in 5s/i }).click();
  await page.waitForTimeout(700);
  const title = await page.title();
  check(/⏱ \d+s/.test(title), "countdown mirrored into the tab title", JSON.stringify(title));
  await page.getByRole("button", { name: /^Cancel$/ }).click();
  await page.waitForTimeout(300);
  check(!/⏱/.test(await page.title()), "title restored after cancel", JSON.stringify(await page.title()));

  await page.getByRole("button", { name: /Stop sharing/i }).click();
  await page.waitForTimeout(200);
  const live = await page.evaluate(() => window.__fakeDisplay.track.readyState);
  check(live === "ended", "Stop sharing ends the capture track", `readyState=${live}`);
  check(await page.getByRole("button", { name: /Start screen capture/i }).isVisible(), "panel returns to the idle state");

  /**
   * Second scenario: repeat shots and several crops from one frame.
   *
   * This is the multi-page workflow — arm it, page through a PDF — and the one
   * place the cropper has to hold state across frames, so it gets its own pass.
   */
  await page.getByRole("button", { name: /^none$/ }).first().click();
  await page.locator('input[type="number"]').nth(1).fill("2");
  await page.getByRole("button", { name: /Start screen capture/i }).click();
  await page.waitForSelector("text=frame 1 of 2", { timeout: 20000 });
  check(true, "repeat capture produced 2 frames");

  const box2 = await page.locator('img[alt^="Screen capture"]').boundingBox();
  const k2 = box2.width / W;
  const drag = async (r) => {
    await page.mouse.move(box2.x + (r.x + 8) * k2, box2.y + (r.y + 8) * k2);
    await page.mouse.down();
    await page.mouse.move(box2.x + (r.x + r.w - 8) * k2, box2.y + (r.y + r.h - 8) * k2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(120);
  };

  // Two regions out of the same frame, then on to the next frame.
  await drag(RED);
  await page.getByRole("button", { name: /Add .+ select another/i }).click();
  await page.waitForTimeout(500);
  check(await page.getByText("frame 1 of 2").isVisible(), "stayed on the same frame for a second crop");
  await drag(BLUE);
  await page.getByRole("button", { name: /Add crop/i }).click();
  await page.waitForSelector("text=frame 2 of 2", { timeout: 15000 });
  check(true, "advanced to the next frame after the crop");

  await page.getByRole("button", { name: /^Done$/ }).click();
  await page.waitForTimeout(400);
  check(!(await page.getByText("Crop the formula").count()), "Done closes the cropper and discards the rest");
  await page
    .waitForFunction(() => document.querySelectorAll('img[alt^="snip-"]').length === 3, null, { timeout: 15000 })
    .catch(() => {});
  check((await page.locator('img[alt^="snip-"]').count()) === 3, "all three crops reached the queue", `${await page.locator('img[alt^="snip-"]').count()} queued`);

  const colours = await page.evaluate(async () => {
    const out = [];
    for (const el of document.querySelectorAll('img[alt^="snip-"]')) {
      const img = new Image();
      img.src = el.src;
      await img.decode();
      const c = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let red = 0, blue = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        n++;
        if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) red++;
        else if (d[i + 2] > 200 && d[i] < 60 && d[i + 1] < 60) blue++;
      }
      out.push(red / n > 0.95 ? "red" : blue / n > 0.95 ? "blue" : "mixed");
    }
    return out;
  });
  check(
    colours.filter((c) => c === "red").length === 2 && colours.filter((c) => c === "blue").length === 1,
    "each crop captured its own region",
    colours.join(", "),
  );
  // keep-alive is on, so the share survived a 2-frame run; stop it explicitly.
  await page.getByRole("button", { name: /Stop sharing/i }).click();

  const real = errors.filter((e) => !/relative paths to specify assets/i.test(e));
  check(real.length === 0, "no page errors", real.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
console.log(`\n${failures ? `!! ${failures} FAILURE(S)` : "ALL CHECKS PASSED"}`);
console.log(`Screenshots: ${OUT}\\snip-cropper-{dark,light}.png`);
process.exit(failures ? 1 : 0);
