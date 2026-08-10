import type { ConvertResult } from "@/types";
import { latexToMathml, cleanLatex } from "./mathRender";
import { escapeHtml, slugify } from "./utils";
// @ts-ignore
import JSZip from "jszip";

export type ExportFormat =
  | "html-double"
  | "html-single"
  | "html-zip"
  | "latex"
  | "mathml"
  | "json"
  | "csv"
  | "markdown"
  | "text";

export interface ExportOption {
  id: ExportFormat;
  label: string;
  ext: string;
  mime: string;
  desc: string;
  icon: string;
}

export const EXPORT_OPTIONS: ExportOption[] = [
  { id: "html-double", label: "HTML · Double Column", ext: "html", mime: "text/html", desc: "Image ↔ MathML+LaTeX side-by-side table", icon: "◳" },
  { id: "html-zip", label: "HTML + ZIP images", ext: "zip", mime: "application/zip", desc: "Self-contained HTML with /images/ folder", icon: "📦" },
  { id: "html-single", label: "HTML · Single Column", ext: "html", mime: "text/html", desc: "Stacked image then rendered math", icon: "▯" },
  { id: "latex", label: "LaTeX (.tex)", ext: "tex", mime: "application/x-tex", desc: "Each expression as an equation", icon: "∑" },
  { id: "mathml", label: "MathML (.mml)", ext: "mml", mime: "application/mathml+xml", desc: "Pure presentation MathML document", icon: "𝕄" },
  { id: "markdown", label: "Markdown (.md)", ext: "md", mime: "text/markdown", desc: "Table with images + LaTeX blocks", icon: "M" },
  { id: "csv", label: "CSV", ext: "csv", mime: "text/csv", desc: "name, latex, mathml", icon: "▤" },
  { id: "json", label: "JSON", ext: "json", mime: "application/json", desc: "Structured data", icon: "{ }" },
  { id: "text", label: "Plain Text", ext: "txt", mime: "text/plain", desc: "One LaTeX expression per line", icon: "T" },
];

function exprsOf(r: ConvertResult): string[] {
  return (r.expressions && r.expressions.length ? r.expressions : []).map(cleanLatex).filter(Boolean);
}

const DOC_STYLE = `
*{box-sizing:border-box}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;margin:0;background:#0b1020;color:#e6e9f2;padding:32px}
h1{font-size:26px;margin:0 0 4px;background:linear-gradient(90deg,#a78bfa,#60a5fa);-webkit-background-clip:text;background-clip:text;color:transparent}
.sub{color:#8b93a7;font-size:13px;margin-bottom:24px}
table{width:100%;border-collapse:separate;border-spacing:0 16px}
td{vertical-align:top;background:#141a30;border:1px solid #232b45;border-radius:14px;padding:0}
.cell{padding:18px}
h3{margin:0 0 12px;font-size:14px;color:#9aa3bd;font-weight:600;display:flex;align-items:center;gap:8px}
.idx{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:7px;background:#2a3357;color:#cdd4ea;font-size:12px}
.imgwrap{background:#0e1428;border-radius:10px;padding:10px;text-align:center;border:1px solid #1c2238}
.imgwrap img{max-width:100%;border-radius:8px;display:block;margin:0 auto}
math{font-size:1.15em;color:#f4f6ff}
math[display="block"]{overflow-x:auto;padding:8px 0}
.expr{border-top:1px dashed #283150;padding:14px 0}
.expr:first-child{border-top:none;padding-top:0}
.code{font-family:'JetBrains Mono','Fira Code',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;background:#0c1124;border:1px solid #202842;border-radius:8px;padding:10px 12px;color:#9fb4ff;white-space:pre-wrap;word-break:break-word;margin-top:10px;position:relative}
.tag{position:absolute;top:8px;right:10px;font-size:10px;letter-spacing:.5px;color:#5f6a8a}
footer{margin-top:28px;color:#5f6a8a;font-size:11px;text-align:center}
@media(max-width:760px){table,tbody,tr,td{display:block;width:100%}}
`;

export function toHTMLDouble(results: ConvertResult[], imgBase = ""): string {
  const rows = results
    .map((r, i) => {
      const exprs = exprsOf(r);
      const mathBlocks = exprs.length
        ? exprs
            .map(
              (e) =>
                `<div class="expr"><div class="mathml">${latexToMathml(e, true)}</div><div class="code"><span class="tag">LaTeX</span>${escapeHtml(e)}</div></div>`,
            )
            .join("")
        : `<div class="expr"><div class="code">${escapeHtml(r.error || "No expressions detected.")}</div></div>`;
      const imgSrc = imgBase ? `${imgBase}/${safeImgName(r, i)}` : r.dataUrl;
      return `<tr class="row">
  <td style="width:42%"><div class="cell"><h3><span class="idx">${i + 1}</span>${escapeHtml(r.fileName)}</h3><div class="imgwrap"><img src="${imgSrc}" alt="${escapeHtml(r.fileName)}"/></div></div></td>
  <td><div class="cell"><h3>MathML &amp; LaTeX</h3>${mathBlocks}</div></td>
</tr>`;
    })
    .join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Mathorium Export — ${results.length} item(s)</title>
<style>${DOC_STYLE}</style></head>
<body>
<h1>⚛ Mathorium — Math Conversion</h1>
<div class="sub">${results.length} image(s) · ${results.reduce((n, r) => n + exprsOf(r).length, 0)} expression(s) · generated ${new Date().toLocaleString()}</div>
<table><tbody>${rows}</tbody></table>
<footer>Generated by Mathorium — Free AI Math OCR &amp; LaTeX / MathML Studio<br/>Developed by Samir Uddin Ahmed</footer>
</body></html>`;
}

export function toHTMLSingle(results: ConvertResult[]): string {
  const blocks = results
    .map((r, i) => {
      const exprs = exprsOf(r);
      const math = exprs.length
        ? exprs.map((e) => `<div class="expr"><div class="mathml">${latexToMathml(e, true)}</div><div class="code">${escapeHtml(e)}</div></div>`).join("")
        : `<div class="expr"><div class="code">${escapeHtml(r.error || "No expressions detected.")}</div></div>`;
      return `<div style="margin-bottom:24px"><div class="cell" style="display:block;background:#141a30;border:1px solid #232b45;border-radius:14px"><h3><span class="idx">${i + 1}</span>${escapeHtml(r.fileName)}</h3><div class="imgwrap" style="margin-bottom:14px"><img src="${r.dataUrl}" alt="${escapeHtml(r.fileName)}"/></div>${math}</div></div>`;
    })
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Mathorium Export</title><style>${DOC_STYLE}</style></head><body><h1>⚛ Mathorium — Math Conversion</h1><div class="sub">${results.length} image(s) · generated ${new Date().toLocaleString()}</div>${blocks}<footer>Generated by Mathorium — Developed by Samir Uddin Ahmed</footer></body></html>`;
}

export function toLatex(results: ConvertResult[]): string {
  const eqs = results
    .map((r) => {
      const exprs = exprsOf(r);
      const body = exprs.map((e) => "\\begin{equation}\n" + e + "\n\\end{equation}").join("\n\n");
      return "% === " + r.fileName + " ===\n" + (body || "% (no expressions)");
    })
    .join("\n\n");
  return `% Mathorium export
% Developed by Samir Uddin Ahmed
\\documentclass{article}
\\usepackage{amsmath,amssymb,amsfonts,mathtools}
\\begin{document}
${eqs}
\\end{document}
`;
}

export function toMathMLDoc(results: ConvertResult[]): string {
  const body = results
    .map(
      (r) =>
        `  <!-- ${escapeHtml(r.fileName)} -->\n` +
        exprsOf(r)
          .map((e) => "  " + latexToMathml(e, true))
          .join("\n"),
    )
    .join("\n\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Mathorium — Developed by Samir Uddin Ahmed -->
<mathset>
${body}
</mathset>
`;
}

export function toJSON(results: ConvertResult[]): string {
  const data = results.map((r) => ({
    fileName: r.fileName,
    expressions: exprsOf(r),
    mathml: exprsOf(r).map((e) => latexToMathml(e, true)),
    error: r.error || null,
  }));
  return JSON.stringify({ generator: "Mathorium", author: "Samir Uddin Ahmed", exportedAt: new Date().toISOString(), count: data.length, results: data }, null, 2);
}

export function toCSV(results: ConvertResult[]): string {
  const rows = [["file", "index", "latex", "mathml"]];
  for (const r of results) {
    const exprs = exprsOf(r);
    if (!exprs.length) rows.push([r.fileName, "1", "", r.error || ""]);
    exprs.forEach((e, j) => rows.push([r.fileName, String(j + 1), e, latexToMathml(e, true)]));
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}
function csvCell(s: string): string {
  return '"' + String(s).replace(/"/g, '""') + '"';
}

export function toMarkdown(results: ConvertResult[]): string {
  const header = `<!-- Mathorium — Developed by Samir Uddin Ahmed -->\n\n# Mathorium Export\n\n${results.length} image(s) · ${new Date().toLocaleString()}\n\n`;
  return (
    header +
    results
      .map((r) => {
        const exprs = exprsOf(r);
        const list = exprs.length
          ? exprs.map((e, i) => `${i + 1}. \`\`\`latex\n${e}\n\`\`\``).join("\n\n")
          : "_No expressions detected._";
        return `## ${r.fileName}\n\n![${r.fileName}](${r.dataUrl})\n\n${list}`;
      })
      .join("\n\n---\n\n")
  );
}

export function toPlainText(results: ConvertResult[]): string {
  const out: string[] = ["# Mathorium — Developed by Samir Uddin Ahmed", ""];
  for (const r of results) {
    out.push(`# ${r.fileName}`);
    const exprs = exprsOf(r);
    if (exprs.length) out.push(...exprs);
    else if (r.error) out.push("# ERROR: " + r.error);
    out.push("");
  }
  return out.join("\n");
}

export function runExport(format: ExportFormat, results: ConvertResult[]): string {
  switch (format) {
    case "html-double":
      return toHTMLDouble(results);
    case "html-single":
      return toHTMLSingle(results);
    case "html-zip":
      return toHTMLDouble(results, "images"); // placeholder – binary ZIP built separately
    case "latex":
      return toLatex(results);
    case "mathml":
      return toMathMLDoc(results);
    case "json":
      return toJSON(results);
    case "csv":
      return toCSV(results);
    case "markdown":
      return toMarkdown(results);
    case "text":
      return toPlainText(results);
  }
}

// ---- ZIP export ----
function safeImgName(r: ConvertResult, i: number): string {
  const base = slugify(r.fileName.replace(/\.[^.]+$/, "")) || `img_${i + 1}`;
  const ext =
    r.dataUrl.match(/^data:image\/(\w+);/i)?.[1]?.replace("jpeg", "jpg") || "png";
  return `${String(i + 1).padStart(3, "0")}_${base}.${ext}`;
}

function dataUrlToUint8(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Build a zip-aware HTML (replace data urls with local filenames)
export function toHTMLDoubleZipAware(results: ConvertResult[]): { html: string; files: { name: string; data: Uint8Array }[] } {
  const files: { name: string; data: Uint8Array }[] = [];
  const nameMap = new Map<string, string>();
  results.forEach((r, i) => {
    const name = safeImgName(r, i);
    nameMap.set(r.id, name);
    if (r.dataUrl.startsWith("data:")) {
      try {
        files.push({ name, data: dataUrlToUint8(r.dataUrl) });
      } catch {}
    }
  });
  // Build rows manually to inject correct filenames
  const rows = results
    .map((r, i) => {
      const exprs = exprsOf(r);
      const mathBlocks = exprs.length
        ? exprs
            .map(
              (e) =>
                `<div class="expr"><div class="mathml">${latexToMathml(e, true)}</div><div class="code"><span class="tag">LaTeX</span>${escapeHtml(e)}</div></div>`,
            )
            .join("")
        : `<div class="expr"><div class="code">${escapeHtml(r.error || "No expressions detected.")}</div></div>`;
      const imgSrc = "images/" + (nameMap.get(r.id) || safeImgName(r, i));
      return `<tr class="row"><td style="width:42%"><div class="cell"><h3><span class="idx">${
        i + 1
      }</span>${escapeHtml(r.fileName)}</h3><div class="imgwrap"><img src="${imgSrc}" alt="${escapeHtml(
        r.fileName,
      )}"/></div></div></td><td><div class="cell"><h3>MathML &amp; LaTeX</h3>${mathBlocks}</div></td></tr>`;
    })
    .join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Mathorium Export — ${results.length} item(s)</title><style>${DOC_STYLE}</style></head><body><h1>⚛ Mathorium — Math Conversion</h1><div class="sub">${results.length} image(s) · ${results.reduce(
    (n, r) => n + exprsOf(r).length,
    0,
  )} expression(s) · generated ${new Date().toLocaleString()}</div><table><tbody>${rows}</tbody></table><footer>Generated by Mathorium — Free AI Math OCR &amp; LaTeX / MathML Studio<br/>Developed by Samir Uddin Ahmed</footer></body></html>`;
  return { html, files };
}

export async function buildExportZipV2(results: ConvertResult[]): Promise<Blob> {
  const zip = new JSZip();
  const { html, files } = toHTMLDoubleZipAware(results);
  const imgFolder = zip.folder("images")!;
  files.forEach((f) => imgFolder.file(f.name, f.data));
  zip.file("index.html", html);
  zip.file(
    "README.txt",
    `Mathorium — Free AI Math OCR & LaTeX / MathML Studio
Developed by Samir Uddin Ahmed

${results.length} images
Exported: ${new Date().toISOString()}

Open index.html in any modern browser.
MathML renders natively (Firefox/Safari/Chrome).
Images are in /images/.

https://mathorium.vercel.app
`,
  );
  return await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
