import { useEffect, useState } from "react";
import { Badge, Button, Modal, Spinner } from "./ui";
import { copyText, download } from "@/lib/utils";

type OS = "windows" | "mac" | "linux" | "unknown";

function detectOS(): OS {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  const plat = (navigator.platform || "").toLowerCase();
  if (ua.includes("win") || plat.includes("win")) return "windows";
  if (ua.includes("mac") || plat.includes("mac")) return "mac";
  if (ua.includes("linux") || plat.includes("linux")) return "linux";
  return "unknown";
}

// Windows auto-fix .bat — sets the env var permanently and restarts Ollama.
const WIN_BAT = `@echo off
REM Mathorium — Ollama CORS one-click fix (permanent)
echo ===================================================
echo  Enabling CORS for Ollama (OLLAMA_ORIGINS=*)
echo ===================================================

REM 1) Set the environment variable permanently for this user
setx OLLAMA_ORIGINS "*"

REM 2) Stop any running Ollama so the new setting takes effect
taskkill /f /im ollama.exe >nul 2>&1
timeout /t 2 /nobreak >nul

REM 3) Restart Ollama (the tray app)
start "" ollama app
timeout /t 3 /nobreak >nul

echo.
echo Done! Ollama is now running with CORS enabled.
echo Go back to Mathorium and try again.
echo.
pause
`;

// macOS auto-fix — sets via launchctl for the session + adds to shell profile.
const MAC_SH = `#!/bin/bash
# Mathorium — Ollama CORS one-click fix (macOS)
echo "==================================================="
echo " Enabling CORS for Ollama (OLLAMA_ORIGINS=*)"
echo "==================================================="

# Set for the current GUI session
launchctl setenv OLLAMA_ORIGINS "*"

# Persist for future terminal sessions
grep -q OLLAMA_ORIGINS ~/.zshrc 2>/dev/null && echo 'export OLLAMA_ORIGINS="*"' >> ~/.zshrc || echo 'export OLLAMA_ORIGINS="*"' >> ~/.zshrc
grep -q OLLAMA_ORIGINS ~/.bash_profile 2>/dev/null && echo 'export OLLAMA_ORIGINS="*"' >> ~/.bash_profile || echo 'export OLLAMA_ORIGINS="*"' >> ~/.bash_profile

# Restart Ollama
pkill -f "Ollama" 2>/dev/null
sleep 2
open -a Ollama 2>/dev/null || ollama serve &

echo ""
echo "Done! Ollama is now running with CORS enabled."
echo "Go back to Mathorium and try again."
`;

const LINUX_SH = `#!/bin/bash
# Mathorium — Ollama CORS one-click fix (Linux)
echo "==================================================="
echo " Enabling CORS for Ollama (OLLAMA_ORIGINS=*)"
echo "==================================================="
export OLLAMA_ORIGINS="*"
grep -q OLLAMA_ORIGINS ~/.bashrc 2>/dev/null || echo 'export OLLAMA_ORIGINS="*"' >> ~/.bashrc
sudo systemctl restart ollama 2>/dev/null || (pkill -f ollama 2>/dev/null; sleep 2; ollama serve &)
echo ""
echo "Done! Go back to Mathorium and try again."
`;

const CMD_PROMPT = `set OLLAMA_ORIGINS="*"
ollama serve`;
const CMD_PS = `$env:OLLAMA_ORIGINS="*"
ollama serve`;

export function OllamaSetupHelper({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [os, setOs] = useState<OS>("unknown");
  const [testing, setTesting] = useState(false);
  const [testState, setTestState] = useState<"idle" | "ok" | "cors" | "down">("idle");

  useEffect(() => {
    if (open) {
      setOs(detectOS());
      setTestState("idle");
    }
  }, [open]);

  const testConnection = async () => {
    setTesting(true);
    setTestState("idle");
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch("http://localhost:11434/api/tags", { signal: controller.signal });
      clearTimeout(t);
      if (res.ok) setTestState("ok");
      else setTestState("cors");
    } catch (e: any) {
      clearTimeout(t);
      const msg = String(e?.message || e).toLowerCase();
      if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("load failed")) {
        // Could be CORS OR server down — probe a second way
        setTestState("cors");
      } else {
        setTestState("down");
      }
    } finally {
      setTesting(false);
    }
  };

  const downloadScript = () => {
    if (os === "windows") download("mathorium-ollama-cors-fix.bat", WIN_BAT, "application/octet-stream");
    else if (os === "mac") download("mathorium-ollama-cors-fix.command", MAC_SH, "application/octet-stream");
    else download("mathorium-ollama-cors-fix.sh", LINUX_SH, "application/octet-stream");
  };

  return (
    <Modal open={open} onClose={onClose} wide title={<span className="flex items-center gap-2">🦙 Ollama Setup Helper <Badge tone="amber">browser security</Badge></span>}
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button></>}>
      <div className="space-y-4 text-sm">
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-amber-200">
          <p className="font-semibold">Why is this needed?</p>
          <p className="mt-1 text-[12px] leading-relaxed text-amber-200/90">
            Browsers block web pages from calling <code className="rounded bg-black/30 px-1">localhost</code> services unless the server sends
            a CORS header. This is a hard browser-security rule — <b>no website can bypass it from JavaScript</b>.
            The fix is to tell Ollama to allow all origins via the <code className="rounded bg-black/30 px-1">OLLAMA_ORIGINS</code> setting.
            The good news: it's a one-time setup. Pick the easiest method below.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400">Detected OS:</span>
          <Badge tone="blue">{os === "unknown" ? "Unknown — pick manually" : os}</Badge>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={testConnection} disabled={testing}>
              {testing ? <><Spinner className="mr-1 h-3 w-3" /> testing…</> : "🔌 Test connection"}
            </Button>
          </div>
        </div>

        {testState === "ok" && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">✓ Ollama is reachable and CORS is enabled. You're all set — try again in Mathorium!</div>}
        {testState === "cors" && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">⚠ Reached localhost but blocked (CORS) or server not running. Apply the fix below, then test again.</div>}
        {testState === "down" && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">✗ Could not reach Ollama. Make sure it's installed and running.</div>}

        {/* Method A: one-click script */}
        <div className="rounded-xl border border-white/10 bg-[var(--surface-well)] p-4">
          <div className="mb-2 flex items-center gap-2">
            <Badge tone="green">Recommended</Badge>
            <h4 className="text-sm font-semibold text-slate-100">A · One-click auto-fix script</h4>
          </div>
          <p className="mb-3 text-[12px] text-slate-400">
            Download a script that sets <code className="rounded bg-black/30 px-1">OLLAMA_ORIGINS=*</code> permanently and restarts Ollama automatically.
          </p>
          <div className="flex flex-wrap gap-2">
            {os === "windows" && <Button size="sm" variant="success" onClick={downloadScript}>⤓ Download fix.bat</Button>}
            {os === "mac" && <Button size="sm" variant="success" onClick={downloadScript}>⤓ Download fix.command</Button>}
            {os === "linux" && <Button size="sm" variant="success" onClick={downloadScript}>⤓ Download fix.sh</Button>}
            {os === "unknown" && (
              <>
                <Button size="sm" variant="success" onClick={() => { setOs("windows"); setTimeout(downloadScript, 30); }}>⤓ Windows .bat</Button>
                <Button size="sm" variant="subtle" onClick={() => { setOs("mac"); setTimeout(downloadScript, 30); }}>⤓ macOS .command</Button>
                <Button size="sm" variant="subtle" onClick={() => { setOs("linux"); setTimeout(downloadScript, 30); }}>⤓ Linux .sh</Button>
              </>
            )}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            {os === "windows" && "After downloading: double-click the .bat file. On the SmartScreen warning click 'More info' → 'Run anyway'."}
            {os === "mac" && "After downloading: double-click the .command file (or run: bash ~/Downloads/mathorium-ollama-cors-fix.command). If blocked: right-click → Open."}
            {os === "linux" && "After downloading: chmod +x the file and run it (uses systemctl if available)."}
          </p>
        </div>

        {/* Method B: manual permanent */}
        <div className="rounded-xl border border-white/10 bg-[var(--surface-well)] p-4">
          <div className="mb-2 flex items-center gap-2">
            <h4 className="text-sm font-semibold text-slate-100">B · Manual permanent fix</h4>
          </div>
          {os === "windows" ? (
            <ol className="list-decimal space-y-1.5 pl-5 text-[12px] text-slate-300">
              <li>Quit Ollama from the System Tray (right-click the llama icon → <b>Quit Ollama</b>).</li>
              <li>Press <kbd className="rounded bg-black/40 px-1">Win</kbd>, type <b>Environment Variables</b>, open <b>Edit the system environment variables</b> → <b>Environment Variables…</b></li>
              <li>Under <b>User variables</b> → <b>New…</b> · Name: <code className="rounded bg-black/30 px-1">OLLAMA_ORIGINS</code> · Value: <code className="rounded bg-black/30 px-1">*</code> → OK.</li>
              <li>Restart Ollama from the Start Menu.</li>
            </ol>
          ) : os === "mac" ? (
            <ol className="list-decimal space-y-1.5 pl-5 text-[12px] text-slate-300">
              <li>Quit Ollama from the menu bar.</li>
              <li>Run in Terminal (sets it for the GUI session):<br />
                <code className="mt-1 block rounded bg-black/40 px-2 py-1 text-[11px]">launchctl setenv OLLAMA_ORIGINS "*"</code>
              </li>
              <li>Relaunch Ollama from Applications.</li>
            </ol>
          ) : (
            <div className="space-y-2 text-[12px] text-slate-300">
              <p>Add to your environment and restart the service:</p>
              <code className="block rounded bg-black/40 px-2 py-1 text-[11px]">export OLLAMA_ORIGINS="*"</code>
              <code className="block rounded bg-black/40 px-2 py-1 text-[11px]">sudo systemctl restart ollama</code>
            </div>
          )}
        </div>

        {/* Method C: temporary command */}
        <div className="rounded-xl border border-white/10 bg-[var(--surface-well)] p-4">
          <div className="mb-2 flex items-center gap-2">
            <h4 className="text-sm font-semibold text-slate-100">C · Temporary (this session only)</h4>
          </div>
          <p className="mb-2 text-[12px] text-slate-400">Quit Ollama, then run in a terminal:</p>
          {os === "windows" ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-black/40 px-2 py-1.5 text-[11px] text-emerald-300">{CMD_PROMPT}</code>
                <Button size="sm" variant="ghost" onClick={() => copyText(CMD_PROMPT)}>⎘</Button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500 w-16">PowerShell</span>
                <code className="flex-1 rounded bg-black/40 px-2 py-1.5 text-[11px] text-emerald-300">{CMD_PS}</code>
                <Button size="sm" variant="ghost" onClick={() => copyText(CMD_PS)}>⎘</Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-black/40 px-2 py-1.5 text-[11px] text-emerald-300">OLLAMA_ORIGINS="*" ollama serve</code>
              <Button size="sm" variant="ghost" onClick={() => copyText('OLLAMA_ORIGINS="*" ollama serve')}>⎘</Button>
            </div>
          )}
        </div>

        <p className="text-center text-[11px] text-slate-500">
          After applying any method, click <b>Test connection</b> — when it turns green, Ollama works in Mathorium. 🎉
        </p>
      </div>
    </Modal>
  );
}
