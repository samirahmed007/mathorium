import { useMemo, useState } from "react";
import type { ConvertResult } from "@/types";
import { EXPORT_OPTIONS, runExport, type ExportFormat, buildExportZipV2 } from "@/lib/exporters";
import { copyText, downloadBlob } from "@/lib/utils";
import { Badge, Button, Modal, Spinner } from "./ui";

export function ExportModal({ open, onClose, results }: { open: boolean; onClose: () => void; results: ConvertResult[] }) {
  const [format, setFormat] = useState<ExportFormat>("html-zip");
  const [copied, setCopied] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [dlError, setDlError] = useState("");
  const [dlSuccess, setDlSuccess] = useState(false);

  const usable = useMemo(() => results.filter((r) => r.expressions.length > 0 || r.raw || r.dataUrl), [results]);
  const opt = EXPORT_OPTIONS.find((o) => o.id === format)!;
  const content = useMemo(() => (format === "html-zip" ? "" : runExport(format, usable)), [format, usable]);

  const handleCopy = async () => {
    if (format === "html-zip") return;
    try {
      const ok = await copyText(content);
      if (!ok) throw new Error("Clipboard blocked");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e: any) {
      alert("Copy failed: " + (e?.message || e));
    }
  };

  const handleDownload = async () => {
    setDlError("");
    setDlSuccess(false);
    if (usable.length === 0) {
      setDlError("No results to export. Convert some images first.");
      return;
    }
    if (format === "html-zip") {
      setZipping(true);
      try {
        const blob = await buildExportZipV2(usable);
        downloadBlob(blob, "mathorium-export.zip");
        setDlSuccess(true);
        setTimeout(() => setDlSuccess(false), 2000);
      } catch (e: any) {
        setDlError("ZIP build failed: " + (e?.message || e));
      } finally {
        setZipping(false);
      }
      return;
    }
    try {
      const blob = new Blob([content], { type: opt.mime + ";charset=utf-8" });
      const ext =
        format === "html-double" || format === "html-single"
          ? "html"
          : opt.ext;
      downloadBlob(blob, `mathorium-export.${ext}`);
      setDlSuccess(true);
      setTimeout(() => setDlSuccess(false), 2000);
    } catch (e: any) {
      setDlError("Download failed: " + (e?.message || e));
    }
  };

  const handlePreview = () => {
    if (format !== "html-double" && format !== "html-single") return;
    try {
      const blob = new Blob([content], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e: any) {
      alert("Preview failed: " + (e?.message || e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={
        <span className="flex items-center gap-2">
          ⤓ Export <Badge tone="blue">{usable.length} items</Badge>
          <span className="text-[11px] font-normal text-slate-500">by Samir Uddin Ahmed</span>
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {(format === "html-double" || format === "html-single") && (
            <Button variant="subtle" onClick={handlePreview}>👁 Open preview</Button>
          )}
          {format !== "html-zip" && (
            <Button variant="outline" onClick={handleCopy}>
              {copied ? "✓ Copied" : "⎘ Copy"}
            </Button>
          )}
          <Button variant="success" onClick={handleDownload} disabled={zipping || usable.length === 0}>
            {zipping ? (
              <>
                <Spinner className="mr-1.5 h-3.5 w-3.5" /> Building ZIP…
              </>
            ) : dlSuccess ? (
              <>✓ Downloaded!</>
            ) : (
              <>⤓ Download .{opt.ext}</>
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {EXPORT_OPTIONS.map((o) => (
            <button
              key={o.id}
              onClick={() => setFormat(o.id)}
              className={
                "rounded-xl border p-3 text-left transition " +
                (format === o.id
                  ? "border-violet-400/60 bg-violet-500/10"
                  : "border-white/10 bg-[var(--surface-well)] hover:border-white/25")
              }
            >
              <div className="text-lg">{o.icon}</div>
              <div className="mt-1 text-xs font-semibold text-slate-200">{o.label}</div>
              <div className="mt-0.5 text-[10px] leading-snug text-slate-500">{o.desc}</div>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="rounded-md bg-white/5 px-2 py-1 font-mono text-slate-400">.{opt.ext}</span>
          <span>· {opt.mime}</span>
          {format !== "html-zip" && (
            <span className="ml-auto">{content.length.toLocaleString()} chars</span>
          )}
          {format === "html-zip" && (
            <span className="ml-auto text-emerald-300">
              Side-by-side table • images in /images/ • offline-ready
            </span>
          )}
        </div>

        {dlError && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {dlError}
          </div>
        )}

        {format === "html-zip" ? (
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 text-sm text-emerald-200">
            <div className="font-semibold mb-1">📦 ZIP bundle export</div>
            <ul className="list-disc pl-5 space-y-1 text-emerald-300/90 text-xs">
              <li>
                <b>index.html</b> — double-column table: left = original image, right = MathML +
                single-line LaTeX
              </li>
              <li>
                <b>images/</b> — all {usable.length} input image(s), numbered &amp; sanitized
              </li>
              <li>100% offline – open index.html in any browser · MathML renders natively</li>
              <li>Developed by <b>Samir Uddin Ahmed</b></li>
            </ul>
            <div className="mt-3">
              <Button
                size="sm"
                variant="success"
                onClick={handleDownload}
                disabled={zipping || usable.length === 0}
              >
                {zipping ? (
                  <>
                    <Spinner className="mr-1.5 h-3.5 w-3.5" /> Building…
                  </>
                ) : (
                  <>⤓ Download ZIP now</>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <pre className="max-h-[46vh] overflow-auto rounded-xl border border-white/10 bg-[var(--surface-sunken)] p-3 text-[11px] leading-relaxed text-slate-300">
            {content.slice(0, 6000)}
            {content.length > 6000 ? "\n…(truncated in preview)" : ""}
          </pre>
        )}
      </div>
    </Modal>
  );
}
