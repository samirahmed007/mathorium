/**
 * CORS proxy probe — runs against the *deployed* site, in a real browser.
 *
 * The proxy only exists to solve a problem that cannot be reproduced with curl:
 * a browser refusing a cross-origin response before the app ever sees it. So the
 * assertions here are made from inside a page served by mathorium.vercel.app,
 * which is the only place the CORS check is real.
 *
 * NVIDIA NIM is the target because it is the provider that actually sends no
 * `access-control-allow-origin` — the direct call is expected to fail, and that
 * failure is what tier 1 exists to catch.
 *
 * A 401/403 from NVIDIA counts as success: it means the request reached NVIDIA
 * with its method, body and Authorization header intact and NVIDIA answered.
 * The only thing under test here is the plumbing, not the key.
 *
 *   node scripts/proxy-probe.mjs [https://mathorium.vercel.app]
 */
import { chromium } from "playwright";

const SITE = (process.argv[2] || "https://mathorium.vercel.app").replace(/\/$/, "");
const NVIDIA = "https://integrate.api.nvidia.com/v1";

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "!! FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(SITE + "/", { waitUntil: "commit" });

console.log(`\n=== tier 1 exists (${SITE}/api/proxy) ===`);
const marker = await page.evaluate(async () => {
  const r = await fetch("/api/proxy", { headers: { "x-proxy-probe": "1" } });
  return { status: r.status, body: (await r.text()).slice(0, 40) };
});
check(marker.status === 200 && marker.body.includes("mathorium-proxy"),
  "the probe the app itself sends is answered", `${marker.status} ${marker.body}`);

console.log("\n=== the CORS wall the proxy exists for ===");
const direct = await page.evaluate(async (base) => {
  try {
    const r = await fetch(base + "/models", { headers: { Authorization: "Bearer nvapi-probe" } });
    return { ok: true, status: r.status };
  } catch (e) {
    return { ok: false, name: e.name, message: String(e.message).slice(0, 80) };
  }
}, NVIDIA);
check(direct.ok === false, "a direct browser call to NVIDIA is blocked, as expected",
  direct.ok ? `unexpectedly got ${direct.status}` : `${direct.name}: ${direct.message}`);

console.log("\n=== tier 1 carries a GET (the model list) ===");
const list = await page.evaluate(async (base) => {
  const t0 = performance.now();
  const r = await fetch("/api/proxy?url=" + encodeURIComponent(base + "/models"), {
    headers: { Authorization: "Bearer nvapi-probe" },
  });
  const text = await r.text();
  return { status: r.status, header: r.headers.get("x-mathorium-proxy"), ms: Math.round(performance.now() - t0), n: (text.match(/"id"/g) || []).length };
}, NVIDIA);
check(list.status === 200, "the proxied model list returns 200", `${list.status} in ${list.ms} ms, ${list.n} ids`);
check(list.header === "origin", "…and is marked as the origin's own answer", String(list.header));
check(list.ms < 5000, "…and returns promptly", `${list.ms} ms`);

console.log("\n=== tier 1 carries an authenticated POST (the chat completion) ===");
const post = await page.evaluate(async (base) => {
  const t0 = performance.now();
  const r = await fetch("/api/proxy?url=" + encodeURIComponent(base + "/chat/completions"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer nvapi-probe" },
    body: JSON.stringify({
      model: "meta/llama-3.3-70b-instruct",
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
      max_tokens: 8,
      stream: false,
    }),
  });
  return { status: r.status, ms: Math.round(performance.now() - t0), body: (await r.text()).slice(0, 90) };
}, NVIDIA);
// 401/403 = the body and the Authorization header both arrived and NVIDIA judged
// the key. A 502 would mean the proxy could not reach NVIDIA at all.
check([401, 403].includes(post.status),
  "the POST reaches NVIDIA with body + auth intact (rejected on the dummy key, not lost)",
  `${post.status} in ${post.ms} ms — ${post.body}`);

console.log("\n=== the 25 s edge ceiling, and telling it apart from the origin ===");
// Vercel's edge runtime must send its first byte within 25 s. A non-streaming
// completion sends nothing until the model finishes, so a slow model hits this
// and the browser is handed a 504 that no application code produced. The client
// has to distinguish that from a 504 the provider itself returned, or it falls
// back nowhere and reports a working key as broken.
const slow = await page.evaluate(async () => {
  const t0 = performance.now();
  const r = await fetch("/api/proxy?url=" + encodeURIComponent("https://httpbin.dev/delay/30"));
  return { status: r.status, header: r.headers.get("x-mathorium-proxy"), ms: Math.round(performance.now() - t0), body: (await r.text()).slice(0, 60) };
});
check(slow.status === 504 && slow.ms < 30000,
  "an upstream that takes >25 s is cut off by the gateway with a 504",
  `${slow.status} at ${(slow.ms / 1000).toFixed(1)} s`);
// This is the assertion the fallback depends on: the gateway cannot set our
// header, because it kills the function before it ever runs.
check(slow.header !== "origin",
  "…and is NOT marked as the origin's answer, so the client can fall through to tier 2",
  `x-mathorium-proxy: ${slow.header ?? "(absent)"}`);

// The mirror image: a 5xx the origin really did send must be passed through and
// marked, so a genuinely failing provider is reported rather than retried blindly.
const real5xx = await page.evaluate(async () => {
  const r = await fetch("/api/proxy?url=" + encodeURIComponent("https://httpbin.dev/status/503"));
  return { status: r.status, header: r.headers.get("x-mathorium-proxy") };
});
check(real5xx.status === 503 && real5xx.header === "origin",
  "a 5xx the origin genuinely sent is relayed and marked as such",
  `${real5xx.status}, x-mathorium-proxy: ${real5xx.header ?? "(absent)"}`);

console.log("\n=== SSRF guard ===");
const ssrf = await page.evaluate(async () => {
  const r = await fetch("/api/proxy?url=" + encodeURIComponent("http://169.254.169.254/latest/meta-data/"));
  return { status: r.status, body: (await r.text()).slice(0, 80) };
});
check(ssrf.status >= 400 && /not proxied/i.test(ssrf.body),
  "link-local and private targets are refused", `${ssrf.status} ${ssrf.body}`);

await browser.close();
console.log(`\n${failures ? `!! ${failures} FAILURE(S)` : "ALL CHECKS PASSED"}`);
process.exit(failures ? 1 : 0);
