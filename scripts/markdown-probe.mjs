/**
 * Chat rendering probe.
 *
 * The answer bubble is the surface users spend all their time reading, and its
 * renderer is hand-written (`components/MarkdownView`) rather than
 * `react-markdown` + plugins, because the single-file build cannot afford that
 * dependency chain. Hand-written means the guarantees a library would give have
 * to be asserted here instead.
 *
 * A conversation is seeded into persisted state so the real compiled renderer is
 * exercised without a provider, a key or a network call. The document below is
 * deliberately hostile: it holds the constructs models actually emit *and* the
 * near-misses that a naive parser mangles — prices that look like maths,
 * snake_case that looks like emphasis, a pipe inside a code span, a
 * `javascript:` URL that must never become a link.
 *
 *   node scripts/markdown-probe.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const URL = "file:///" + resolve(root, "dist/index.html").replace(/\\/g, "/");

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "!! FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
};

const LONG_CODE = Array.from({ length: 40 }, (_, i) => `  const line${i} = ${i} * 2; // row ${i}`).join("\n");

const DOC = `# Heading one
## Heading two
### Heading three

A paragraph with **bold**, *italic*, ***both***, ~~struck~~, \`inline_code()\` and a
soft line break above this one.

Nested emphasis: **bold with \`code\` and *italic* inside**.

Prices are not maths: it costs $5 and $10, or $12.50 total.
Identifiers are not emphasis: my_variable_name and snake_case_thing stay literal.
Escaped markers stay literal: \\*not italic\\* and \\$not maths\\$.

Inline maths $E = mc^2$ and $\\frac{a}{b}$ sit in the sentence.

$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$

\\[ \\sum_{k=1}^{n} k = \\frac{n(n+1)}{2} \\]

| Method | Speed | Accuracy |
|:-------|:-----:|---------:|
| Pix2Text | fast | **96%** |
| Tesseract | faster | 71% |
| A \`pipe \\| inside\` code | mid | 88% |

- top level bullet
  - nested bullet
    - third level
- second top bullet with a wrapped line
  that continues here

3. ordered starting at three
4. second ordered item
   1. nested ordered

- [x] a finished task
- [ ] an unfinished task

> A quotation.
> > Nested deeper.

---

A [safe link](https://example.com/docs) and a bare URL https://mathorium.example/page and
an [unsafe one](javascript:alert(1)) that must not be clickable.

\`\`\`python
def solve(a, b):
    return (a ** 2 + b ** 2) ** 0.5   # hypotenuse
\`\`\`

\`\`\`js
${LONG_CODE}
\`\`\`
`;

const CONV = {
  id: "md-probe",
  title: "Rendering probe",
  messages: [
    { id: "u1", role: "user", content: "render everything", createdAt: 1 },
    { id: "a1", role: "assistant", content: DOC, createdAt: 2, provider: "probe", model: "probe" },
  ],
  createdAt: 1,
  updatedAt: 2,
};

const browser = await chromium.launch();

for (const mode of ["dark", "light"]) {
  console.log(`\n=== ${mode} ===`);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // The schema stamp is as load-bearing as the conversation: without it the store
  // treats this as a first run and returns INITIAL, discarding the seed.
  await page.addInitScript((conv) => {
    localStorage.setItem("mathforge.schema", "24");
    const KEY = "mathforge.state.v4";
    let s = {};
    try { s = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { s = {}; }
    s.conversations = [conv];
    s.activeConversationId = conv.id;
    localStorage.setItem(KEY, JSON.stringify(s));
  }, CONV);

  await page.goto(URL);
  await page.waitForSelector("header", { timeout: 30000 });
  for (const label of [/get started/i, /skip/i, /got it/i, /close/i]) {
    const b = page.getByRole("button", { name: label });
    if (await b.count()) { await b.first().click({ timeout: 2000 }).catch(() => {}); break; }
  }
  if (mode === "light") {
    await page.getByRole("button", { name: /^Theme:/ }).first().click();
    await page.waitForTimeout(250);
  }
  await page.locator("aside").getByRole("button", { name: /Chat/i }).first().click();
  await page.waitForSelector(".mf-md", { timeout: 20000 });
  await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation:none!important}" });
  const md = page.locator(".mf-md").first();

  // ── structure ───────────────────────────────────────────────────────────
  const counts = await md.evaluate((el) => ({
    h1: el.querySelectorAll("h1").length,
    h2: el.querySelectorAll("h2").length,
    h3: el.querySelectorAll("h3").length,
    tables: el.querySelectorAll("table").length,
    th: el.querySelectorAll("th").length,
    bodyRows: el.querySelectorAll("tbody tr").length,
    ul: el.querySelectorAll("ul").length,
    ol: el.querySelectorAll("ol").length,
    blockquote: el.querySelectorAll("blockquote").length,
    pre: el.querySelectorAll("pre").length,
    katex: el.querySelectorAll(".katex").length,
    katexDisplay: el.querySelectorAll(".katex-display").length,
    links: el.querySelectorAll("a").length,
  }));
  check(counts.h1 === 1 && counts.h2 === 1 && counts.h3 === 1, "headings render at their own levels", JSON.stringify({ h1: counts.h1, h2: counts.h2, h3: counts.h3 }));
  check(counts.tables === 1 && counts.th === 3 && counts.bodyRows === 3, "GFM table becomes a real table", `${counts.tables} table, ${counts.th} headers, ${counts.bodyRows} rows`);
  check(counts.blockquote === 2, "blockquotes nest", `${counts.blockquote} found`);
  check(counts.pre === 2, "both fenced blocks render as code", `${counts.pre} found`);
  check(counts.katexDisplay >= 2, "display maths renders as display KaTeX", `${counts.katexDisplay} display, ${counts.katex} total`);

  // ── tables: alignment, and a pipe that lives inside a code span ─────────
  const table = await md.evaluate((el) => {
    const t = el.querySelector("table");
    if (!t) return null;
    const align = [...t.querySelectorAll("th")].map((th) => getComputedStyle(th).textAlign);
    const cell = t.querySelector("tbody tr:nth-child(3) td");
    return { align, thirdRowFirstCell: cell?.textContent?.trim() ?? "", cols: [...t.querySelectorAll("tbody tr")].map((r) => r.children.length) };
  });
  check(JSON.stringify(table?.align) === JSON.stringify(["left", "center", "right"]), "column alignment follows the |:--:| row", JSON.stringify(table?.align));
  check(table?.cols.every((n) => n === 3), "every row has the header's column count", JSON.stringify(table?.cols));
  check(/pipe \| inside/.test(table?.thirdRowFirstCell || ""), "an escaped pipe inside a code span does not split the cell", table?.thirdRowFirstCell);

  // ── lists: nesting, ordered start, tasks ────────────────────────────────
  const lists = await md.evaluate((el) => {
    const depth = (node) => { let d = 0, p = node.parentElement; while (p) { if (p.tagName === "UL" || p.tagName === "OL") d++; p = p.parentElement; } return d; };
    const deepest = Math.max(0, ...[...el.querySelectorAll("li")].map(depth));
    const ol = el.querySelector("ol");
    const boxes = [...el.querySelectorAll("li")].filter((li) => li.querySelector('span[aria-hidden="true"]'));
    return {
      deepest,
      olStart: ol?.getAttribute("start"),
      olMarker: ol ? getComputedStyle(ol).listStyleType : "",
      firstOlNumber: ol ? getComputedStyle(ol.querySelector("li"), "::marker").content : "",
      taskItems: boxes.length,
      struck: boxes.filter((li) => li.textContent.includes("finished task") && li.querySelector(".line-through")).length,
    };
  });
  check(lists.deepest >= 3, "bullets nest three deep", `deepest = ${lists.deepest}`);
  check(lists.olStart === "3" && lists.olMarker === "decimal", "an ordered list starting at 3 numbers from 3", `start=${lists.olStart} type=${lists.olMarker}`);
  check(lists.taskItems === 2, "task-list checkboxes render", `${lists.taskItems} found`);
  check(lists.struck === 1, "a completed task is struck through");

  // ── the near-misses a naive parser mangles ─────────────────────────────
  const text = await md.innerText();
  check(/it costs \$5 and \$10, or \$12\.50 total/.test(text), "prices are not parsed as maths", text.match(/it costs[^\n]*/)?.[0] ?? "line missing");
  check(/my_variable_name and snake_case_thing/.test(text), "snake_case is not parsed as emphasis", text.match(/Identifiers[^\n]*/)?.[0] ?? "line missing");
  check(/\*not italic\* and \$not maths\$/.test(text), "backslash-escaped markers stay literal", text.match(/Escaped markers[^\n]*/)?.[0] ?? "line missing");
  const emphasis = await md.evaluate((el) => ({
    strongInStrong: !!el.querySelector("strong code") && !!el.querySelector("strong em"),
    strong: el.querySelectorAll("strong").length,
    em: el.querySelectorAll("em").length,
    del: el.querySelectorAll("s").length,
    softBreaks: el.querySelectorAll("p br").length,
  }));
  check(emphasis.strongInStrong, "emphasis nests (code and italics inside bold)");
  check(emphasis.del >= 1 && emphasis.em >= 2 && emphasis.strong >= 3, "bold / italic / strikethrough all render", JSON.stringify(emphasis));
  check(emphasis.softBreaks >= 1, "a single newline inside a paragraph is a line break");

  // ── links: only safe schemes become clickable ───────────────────────────
  const links = await md.evaluate((el) =>
    [...el.querySelectorAll("a")].map((a) => ({ href: a.getAttribute("href"), rel: a.getAttribute("rel"), target: a.getAttribute("target") })),
  );
  check(links.some((l) => l.href === "https://example.com/docs"), "an inline link becomes an anchor");
  check(links.some((l) => l.href === "https://mathorium.example/page"), "a bare URL is auto-linked");
  check(!links.some((l) => /^javascript:/i.test(l.href || "")), "a javascript: URL never becomes an href", links.map((l) => l.href).join(" "));
  check(/unsafe one/.test(text), "the rejected link's text is still shown, inert");
  check(links.every((l) => l.target === "_blank" && /noopener/.test(l.rel || "")), "external links open safely (noopener)", JSON.stringify(links[0] ?? {}));

  // ── code block chrome ───────────────────────────────────────────────────
  const codeHead = await md.evaluate((el) => {
    const first = el.querySelectorAll(".group\\/code")[0];
    return { label: first?.querySelector("span")?.textContent?.trim() ?? "", buttons: [...first.querySelectorAll("button")].map((b) => b.textContent.trim()) };
  });
  check(codeHead.label.toLowerCase() === "python", "a fenced block shows its language", codeHead.label);
  check(codeHead.buttons.some((b) => /copy/i.test(b)) && codeHead.buttons.some((b) => /\.py$/.test(b)), "copy and language-correct download are offered", codeHead.buttons.join(" | "));
  check(
    await md.locator("button", { hasText: /^Show all 40 lines$/ }).first().isVisible().catch(() => false),
    "a long block is collapsed with an exact line count",
  );
  await md.locator("button", { hasText: /^Show all 40 lines$/ }).first().click();
  check(
    await md.locator("button", { hasText: /^Collapse$/ }).first().waitFor({ state: "visible", timeout: 4000 }).then(() => true, () => false),
    "expanding a long block reveals a Collapse control",
  );
  const syntaxColours = await md.evaluate((el) => {
    const pre = el.querySelector("pre");
    return new Set([...pre.querySelectorAll("span")].map((s) => getComputedStyle(s).color)).size;
  });
  check(syntaxColours >= 3, "code is syntax-coloured, not monochrome", `${syntaxColours} distinct colours`);

  // ── it must not overflow its column ─────────────────────────────────────
  const overflow = await md.evaluate((el) => {
    const bubble = el.closest("div[class*='rounded-2xl']") || el.parentElement;
    const limit = bubble.getBoundingClientRect().right + 1;
    return [...el.querySelectorAll("p, li, h1, h2, h3, table, .katex-display")]
      .filter((n) => n.getBoundingClientRect().right > limit)
      .map((n) => `${n.tagName}: ${n.textContent.slice(0, 40)}`);
  });
  check(overflow.length === 0, "nothing spills outside the message bubble", overflow.slice(0, 2).join(" | "));

  await page.screenshot({ path: resolve(root, ".theme-audit", `markdown-${mode}.png`), fullPage: true });

  const real = errors.filter((e) => !/relative paths to specify assets/i.test(e));
  check(real.length === 0, "no page errors", real.slice(0, 2).join(" | "));

  await ctx.close();
}

// ---------------------------------------------------------------------------
// Streaming pass.
//
// The caret and the code block's "writing…" state only exist while tokens are in
// flight, so they cannot be asserted from a seeded conversation — there is no
// stream. A local SSE server stands in for a provider and deliberately answers
// slowly, which drives the real send → stream → render path and lets the
// half-finished states be observed while they are on screen.
// ---------------------------------------------------------------------------
console.log("\n=== streaming ===");

const CHUNKS = [
  "Let me work through it.\n\n",
  "The identity is $a^2",
  " + b^2 = c^2$, and in display form:\n\n$$c = \\sqrt{a^2 + b^2}$$\n\n",
  // The fence is opened and closed several ticks apart on purpose: the
  // still-arriving marker only exists in that gap, and with the body in a single
  // chunk the gap is one tick — short enough that the assertion below is racing
  // the render rather than observing a state the user would actually see.
  "```py\ndef hyp(a, b):\n",
  "    # pythagoras\n",
  "    return (a*a + b*b) ** 0.5\n",
  "```\n\nDone.",
];

const server = createServer((req, res) => {
  // file:// pages send Origin: null, which only a wildcard satisfies.
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
  if (req.url.includes("/models")) {
    res.writeHead(200, { ...cors, "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "probe-model" }] }));
    return;
  }
  res.writeHead(200, { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  let i = 0;
  const tick = setInterval(() => {
    if (i < CHUNKS.length) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: CHUNKS[i++] } }] })}\n\n`);
      return;
    }
    clearInterval(tick);
    res.write("data: [DONE]\n\n");
    res.end();
  }, 420);
  req.on("close", () => clearInterval(tick));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/v1`;

{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.addInitScript((baseUrl) => {
    localStorage.setItem("mathforge.schema", "24");
    const KEY = "mathforge.state.v4";
    let s = {};
    try { s = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { s = {}; }
    s.providers = [{
      id: "probe-srv", name: "Probe Server", baseUrl, chatPath: "/chat/completions",
      authScheme: "bearer", apiKey: "probe-key", kind: "openai", free: true, builtin: false,
      // `vision: true` is load-bearing, not decoration. The app opens on Convert,
      // whose picker lists only vision-capable providers and moves the selection
      // to the first one that qualifies — so a text-only probe provider is
      // switched away to Puter before Chat is ever reached.
      models: [{ id: "probe-model", label: "Probe Model", vision: true, free: true }],
      visionDefault: "probe-model",
      textDefault: "probe-model",
    }];
    s.activeProviderId = "probe-srv";
    s.activeModelId = "probe-model";
    s.conversations = [];
    s.activeConversationId = null;
    // Agent Mode ships on, and it answers through the planner/auditor path
    // (`agentReplyStream`) rather than streaming provider tokens into the bubble.
    // This pass is about the renderer's streaming states, so it takes the direct
    // path; the local server already sends CORS headers, so the proxy is off too.
    s.settings = { agentMode: false, streamChat: true, autoCorsProxy: false };
    localStorage.setItem(KEY, JSON.stringify(s));
  }, base);

  await page.goto(URL);
  await page.waitForSelector("header", { timeout: 30000 });
  for (const label of [/get started/i, /skip/i, /got it/i, /close/i]) {
    const b = page.getByRole("button", { name: label });
    if (await b.count()) { await b.first().click({ timeout: 2000 }).catch(() => {}); break; }
  }
  await page.locator("aside").getByRole("button", { name: /Chat/i }).first().click();
  const box = page.locator("textarea").first();
  await box.waitFor({ state: "visible", timeout: 20000 });
  await box.fill("prove pythagoras");
  await box.press("Enter");

  // Mid-stream: the caret is showing and the fence has not closed yet.
  const caret = page.locator(".mf-caret").first();
  check(await caret.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false), "a caret marks the answer as still streaming");
  // An unclosed fence holds its marker for a whole tick (the body is sent on
  // its own line), so this window is comfortably wider than one chunk gap.
  check(
    await page.getByText(/writing…/).first().waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false),
    "an unclosed code fence renders as a block that is still arriving",
  );
  // Partial maths must not blank the bubble or throw.
  const mid = await page.locator(".mf-md").first().innerText();
  check(/Let me work through it/.test(mid), "text already received is on screen while the rest arrives", mid.split("\n")[0]);

  // Settled: caret gone, everything parsed.
  await page.waitForFunction(() => !document.querySelector(".mf-caret"), null, { timeout: 20000 }).catch(() => {});
  check(await page.locator(".mf-caret").count() === 0, "the caret disappears when the answer completes");
  const done = await page.locator(".mf-md").first().evaluate((el) => ({
    katex: el.querySelectorAll(".katex").length,
    display: el.querySelectorAll(".katex-display").length,
    pre: el.querySelectorAll("pre").length,
    lang: el.querySelector(".group\\/code span")?.textContent?.trim() ?? "",
    writing: /writing…/.test(el.textContent),
  }));
  check(done.katex >= 2 && done.display >= 1, "inline and display maths both resolve after streaming", JSON.stringify(done));
  check(done.pre === 1 && done.lang.toLowerCase() === "py", "the finished fence keeps its language", `${done.pre} block, lang=${done.lang}`);
  check(!done.writing, "the still-arriving marker clears once the fence closes");

  await page.screenshot({ path: resolve(root, ".theme-audit", "markdown-streamed.png"), fullPage: true });
  const real = errors.filter((e) => !/relative paths to specify assets/i.test(e));
  check(real.length === 0, "no page errors during streaming", real.slice(0, 2).join(" | "));
  await ctx.close();
}

server.close();
await browser.close();
console.log(`\n${failures ? `!! ${failures} FAILURE(S)` : "ALL CHECKS PASSED"}`);
process.exit(failures ? 1 : 0);
