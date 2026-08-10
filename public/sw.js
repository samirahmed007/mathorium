// Mathorium 9.0 Service Worker — offline-first cache for the single-file bundle.
// Bumping this on every release is what evicts the previous build: the activate
// handler deletes every cache whose name is not CACHE_NAME, so a stale v8.2 bundle
// cannot survive and serve old code to a returning user.
const CACHE_NAME = "mathorium-v9.0-cache-v1";

/**
 * Installed eagerly, because these are what the shell needs to open at all.
 *
 * js.puter.com/v2/ is deliberately NOT here: it serves no
 * access-control-allow-origin header, and `cache.add()` fetches in CORS mode, so the
 * entry always rejected (silently, thanks to allSettled below) and only cost an
 * install-time round trip. The runtime handler below still passes the no-cors script
 * request straight through, which is how it actually loads.
 */
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "https://cdn.jsdelivr.net/npm/katex@0.17.0/dist/katex.min.css",
];

/**
 * The offline OCR payload: onnxruntime's WASM plus the Pix2Text weights, ~60 MB.
 *
 * Warmed in the background after install rather than awaited with the shell, so a
 * first visit is not held behind 60 MB — but warmed *without being asked*, because
 * "offline OCR" that only works if you happened to run OCR once while online is not
 * offline. `int8` is the decoder the app actually loads; the fp32 decoder is left to
 * the runtime handler so precache stays under the size where a browser starts
 * evicting the whole origin.
 */
const MODEL_URLS = [
  "./ort/ort-wasm-simd-threaded.mjs",
  "./ort/ort-wasm-simd-threaded.wasm",
  "./ort/ort-wasm-simd-threaded.jsep.mjs",
  "./ort/ort-wasm-simd-threaded.jsep.wasm",
  "./models/pix2text-mfr-quantized/config.json",
  "./models/pix2text-mfr-quantized/generation_config.json",
  "./models/pix2text-mfr-quantized/preprocessor_config.json",
  "./models/pix2text-mfr-quantized/tokenizer.json",
  "./models/pix2text-mfr-quantized/tokenizer_config.json",
  "./models/pix2text-mfr-quantized/special_tokens_map.json",
  "./models/pix2text-mfr-quantized/onnx/encoder_model.onnx",
  "./models/pix2text-mfr-quantized/onnx/decoder_model_int8.onnx",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Use addAll but tolerate individual failures (network offline for CDN URLs).
      Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      // Only once the shell is live and the old caches are gone: pulling 60 MB of
      // weights while the previous build's cache is still resident would need room
      // for both at once, which is exactly when a browser evicts the origin.
      .then(() => warmModels()),
  );
  self.clients.claim();
});

/**
 * Fetch the OCR payload into the cache, one file at a time and failing quietly.
 *
 * Sequential on purpose: twelve parallel requests for a 23 MB encoder and an 8 MB
 * decoder saturate a slow connection and make the app that is *already usable* feel
 * broken. A failure here costs nothing — the runtime handler will fetch and cache
 * the file on first use, exactly as before.
 */
async function warmModels() {
  const cache = await caches.open(CACHE_NAME);
  for (const url of MODEL_URLS) {
    try {
      if (await cache.match(url)) continue;
      await cache.add(url);
    } catch {
      /* offline, or not deployed with the model bundle — try again next activate */
    }
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only handle GET
  if (req.method !== "GET") return;

  // Network-first for navigation (so updates are picked up), cache fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./"))),
    );
    return;
  }

  // Cache-first for everything else (KaTeX CSS, bundle assets, model files).
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Only cache successful responses from same-origin or known CDNs.
          // js.puter.com is intentionally absent: it is loaded by a classic
          // script tag with no crossOrigin (it sends no ACAO header), so the
          // response here is opaque — `res.ok` is false for opaque responses and
          // `cache.put` would reject on one anyway. It simply passes through.
          if (
            res.ok &&
            (req.url.startsWith(self.location.origin) ||
              req.url.includes("cdn.jsdelivr.net"))
          ) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
    }),
  );
});
