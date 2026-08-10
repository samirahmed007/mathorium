import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { cpSync, readFileSync, statSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Copy `public/` into `dist/` after the bundle is written.
 *
 * `viteSingleFile` inlines the JS and CSS into one `index.html`, but the offline OCR
 * payload — onnxruntime's WASM and the Pix2Text weights — must stay as separate files:
 * they are fetched at runtime and streamed into `ort.InferenceSession`, and base64 in
 * the HTML would both defeat that and inflate 60 MB to 80.
 *
 * This used to also mirror every model file into a second `resolve/main/` tree, the
 * layout transformers.js derives from a HuggingFace repo id. Nothing reads it: the
 * decoder that ships is cache-less, so `lib/pix2text` drives onnxruntime directly and
 * fetches `models/pix2text-mfr-quantized/onnx/…` by path. The mirror was duplicating
 * 61 MB of weights into every deployment for a library the app does not use.
 */
function copyPublicAssets() {
  return {
    name: "copy-public-assets",
    closeBundle() {
      const dist = path.resolve(__dirname, "dist");
      try {
        cpSync(path.resolve(__dirname, "public"), dist, { recursive: true });
        console.log("✓ Copied public/ assets to dist/");
        // Loud, because a deployment that silently lost the weights looks fine until
        // someone switches off the network and offline OCR turns out to need one.
        const enc = path.resolve(dist, "models/pix2text-mfr-quantized/onnx/encoder_model.onnx");
        console.log(`✓ Offline OCR encoder present (${(statSync(enc).size / 1048576).toFixed(1)} MB)`);
      } catch (e) {
        console.warn("Could not copy public/ assets:", e instanceof Error ? e.message : String(e));
      }
    },
  };
}

/**
 * Move the inlined bundle to the end of `<body>`.
 *
 * Vite emits its module script into `<head>`, and `viteSingleFile` inlines 16 MB of
 * JavaScript wherever that tag happens to sit. That pushes `<body>` past byte 16 M,
 * which breaks two things at once:
 *
 *   - Googlebot truncates an HTML response at 15 MB. Every crawlable thing in the
 *     document — the boot shell's copy, the H1, the noscript — lived after the cut,
 *     so the SEO payload was fetched by nobody.
 *   - The parser has to stream all 16 MB before it reaches the markup it can paint,
 *     so the boot shell appeared at the *end* of the download rather than the start.
 *
 * Moving the tag is safe: `type="module"` is deferred either way, so execution order
 * is unchanged. The script just stops standing in front of the document.
 */
function inlineScriptLast() {
  return {
    name: "inline-script-last",
    enforce: "post" as const,
    generateBundle(_options: unknown, bundle: Record<string, { type: string; source?: unknown }>) {
      for (const [name, asset] of Object.entries(bundle)) {
        if (!name.endsWith(".html") || asset.type !== "asset") continue;
        const html = String(asset.source);
        const open = html.search(/<script type="module"[^>]*>/);
        if (open === -1) continue;
        const close = html.indexOf("</script>", open);
        const body = html.lastIndexOf("</body>");
        // Already last, or a shape this transform does not understand: leave it be
        // rather than corrupting the only artifact the deployment has.
        if (close === -1 || body === -1 || open > body) continue;
        const tag = html.slice(open, close + "</script>".length);
        const rest = html.slice(0, open) + html.slice(close + "</script>".length);
        const at = rest.lastIndexOf("</body>");
        asset.source = `${rest.slice(0, at)}    ${tag}\n  ${rest.slice(at)}`;
        console.log(`✓ Moved the inlined bundle to the end of <body> (crawlable head + shell: ${(open / 1024).toFixed(1)} KB)`);
      }
    },
  };
}

/**
 * Fail the build if `package.json` and `src/lib/version.ts` disagree.
 *
 * They have to be separate — npm owns one, the bundle imports the other — so the
 * only thing keeping them in step is a check. Before v9 the UI shipped four
 * different version numbers across the header, sidebar, About dialog and Settings
 * blurb, which is what happens when nothing asserts.
 */
function assertVersionsAgree() {
  return {
    name: "assert-versions-agree",
    buildStart() {
      const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8"));
      const src = readFileSync(path.resolve(__dirname, "src/lib/version.ts"), "utf8");
      const build = (src.match(/APP_BUILD\s*=\s*"([^"]+)"/) || [])[1];
      if (build !== pkg.version) {
        throw new Error(
          `Version mismatch: package.json says ${pkg.version}, src/lib/version.ts says ${build}. ` +
            `Update both — the UI reads version.ts and npm reads package.json.`,
        );
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [assertVersionsAgree(), react(), tailwindcss(), viteSingleFile(), inlineScriptLast(), copyPublicAssets()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
  },
});
