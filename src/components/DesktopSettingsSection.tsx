import { useEffect, useState } from "react";

function friendlyShortcut(value:string) {
  return value.replace("Control","Ctrl").replace("Command","Cmd");
}
function electronShortcut(value:string) {
  return value.trim().replace(/\bCtrl\b/gi,"Control").replace(/\bWin\b/gi,"Super");
}
export function DesktopSettingsSection() {
  const api=window.mathoriumDesktop;
  const [shortcut,setShortcut]=useState("Ctrl+Alt+M");
  const [status,setStatus]=useState("Loading shortcut…");
  const [models,setModels]=useState<any>(null);
  const [error,setError]=useState("");
  const refresh=async()=>{
    if(!api)return;
    try {
      const [s,m]=await Promise.all([api.getGlobalShortcut(),api.getModelStatus()]);
      setShortcut(friendlyShortcut(s.accelerator));setModels(m);
      setStatus(s.registered?"Registered and active":"Not registered");
    } catch(e:any) {setError(e?.message||String(e));}
  };
  useEffect(()=>{
    if(!api?.isDesktop)return;
    void refresh();
    const off=api.onShortcutStatus(s=>{setStatus(s.ok?"Registered and active":"Registration failed");});
    return off;
  },[]);
  if(!api?.isDesktop)return null;
  const save=async()=>{
    setError("");
    try {
      const result=await api.setGlobalShortcut(electronShortcut(shortcut));
      if(!result.ok)throw new Error(result.error||"Could not register shortcut.");
      setStatus("Registered and active");setShortcut(friendlyShortcut(result.accelerator||shortcut));
    } catch(e:any) {setError(e?.message||String(e));}
  };
  const modelRow=(name:string,entry:any)=>(
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2">
      <div><div className="text-xs font-medium text-slate-200">{name}</div><div className="text-[10px] text-slate-500">{entry?.ready?"Required files found":"One or more required files are missing"}</div></div>
      <span className={"rounded-full px-2 py-1 text-[10px] font-semibold "+(entry?.ready?"bg-emerald-500/10 text-emerald-300":"bg-amber-500/10 text-amber-200")}>{entry?.ready?"Installed":"Incomplete"}</span>
    </div>
  );
  return <section className="space-y-3 rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] p-4">
    <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-violet-200">Mathorium Desktop · Native capture & offline models</h3><span className="rounded-full bg-violet-500/10 px-2 py-1 text-[10px] text-violet-200">Desktop</span></div>
    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
      <label className="space-y-1"><span className="text-xs text-slate-300">Global New Snip shortcut</span><input value={shortcut} onChange={e=>setShortcut(e.target.value)} placeholder="Ctrl+Alt+M" className="h-9 w-full rounded-lg border border-white/10 bg-[var(--surface-well)] px-3 text-sm text-slate-100 outline-none focus:border-violet-400/60"/><span className="block text-[10px] text-slate-500">Use accelerator notation, e.g. Ctrl+Alt+M. Conflicts with OS-reserved or other-app shortcuts are reported.</span></label>
      <div className="flex items-end"><button onClick={()=>void save()} className="h-9 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white hover:bg-violet-500">Save shortcut</button></div>
    </div>
    <div className="text-[11px] text-slate-400">Shortcut status: <b className="text-slate-200">{status}</b></div>
    {error&&<div role="alert" className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">{error}</div>}
    <div className="space-y-2">
      <div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-300">Bundled recognition engines</span><button onClick={()=>void refresh()} className="text-[11px] text-violet-300 hover:text-violet-200">Refresh integrity status</button></div>
      {modelRow("Pix2Text MFR · ONNX",models?.pix2text)}
      {modelRow("TexTeller 3.0 · INT8 encoder + merged decoder",models?.texteller)}
      <div className="rounded-lg border border-white/8 bg-black/10 px-3 py-2 text-[10px] leading-relaxed text-slate-400">{models?.complete?"Both model bundles passed the file-presence check. Hash and inference verification are performed by the build/test workflow.":"This installation is not yet model-complete. Recognition for a missing engine stays disabled; no cloud or text OCR fallback is used."}</div>
    </div>
  </section>;
}
