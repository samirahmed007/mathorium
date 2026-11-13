import { useMemo, useState } from "react";
import type { ConvertResult } from "@/types";
import { MathView } from "./MathView";

export function SnipLibraryTab({items,onRename,onDelete,onToggleFavorite,onCopy,onEditLatex,onEditMathType}:{
  items:ConvertResult[];
  onRename:(id:string,name:string)=>void;
  onDelete:(id:string)=>void;
  onToggleFavorite:(id:string)=>void;
  onCopy:(latex:string)=>void;
  onEditLatex:(id:string,index:number)=>void;
  onEditMathType:(id:string,index:number)=>void;
}) {
  const [query,setQuery]=useState("");
  const [scope,setScope]=useState<"all"|"favorites"|"failed">("all");
  const filtered=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return items.filter(item=>{
      if(scope==="favorites"&&!item.favorite)return false;
      if(scope==="failed"&&item.status!=="error")return false;
      return !q||[item.displayName,item.fileName,item.raw,...(item.expressions||[])].join(" ").toLowerCase().includes(q);
    }).sort((a,b)=>Number(!!b.favorite)-Number(!!a.favorite)||b.createdAt-a.createdAt);
  },[items,query,scope]);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-semibold text-white">Snip Library</h2><p className="text-xs text-slate-500">Local screenshots, source images and recognized mathematical output · {items.length} saved</p></div>
      <div className="flex gap-2">
        {(["all","favorites","failed"] as const).map(v=><button key={v} onClick={()=>setScope(v)} className={"rounded-lg border px-3 py-2 text-xs capitalize "+(scope===v?"border-violet-400/40 bg-violet-500/15 text-violet-200":"border-white/10 text-slate-400 hover:bg-white/5")}>{v}</button>)}
      </div>
    </div>
    <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search filenames and recognized formulas…" className="h-10 w-full rounded-xl border border-white/10 bg-[var(--surface-well)] px-3 text-sm text-slate-100 outline-none focus:border-violet-400/50"/>
    {!filtered.length&&<div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-slate-500">{items.length?"No Snips match this filter.":"Your Snip Library is empty. Capture a formula or import an image to get started."}</div>}
    <div className="grid gap-3 xl:grid-cols-2">
      {filtered.map(item=>{
        const latex=item.expressions?.[0]||item.raw||"";
        return <article key={item.id} className="overflow-hidden rounded-2xl border border-white/8 bg-[var(--surface-card)]">
          <div className="flex items-start gap-3 p-3">
            <img src={item.dataUrl} alt={item.fileName} className="h-24 w-32 shrink-0 rounded-lg bg-white/5 object-contain"/>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-slate-200">{item.displayName||item.fileName}</div>
              <div className="mt-1 text-[10px] text-slate-500">{new Date(item.createdAt).toLocaleString()} · {item.model||item.provider||"Not recognized"}</div>
              <div className="mt-2"><span className={"rounded-full px-2 py-1 text-[10px] "+(item.status==="done"?"bg-emerald-500/10 text-emerald-300":item.status==="error"?"bg-rose-500/10 text-rose-300":"bg-sky-500/10 text-sky-300")}>{item.status}</span></div>
              {item.error&&<p className="mt-2 line-clamp-2 text-[10px] text-rose-300">{item.error}</p>}
            </div>
            <button title={item.favorite?"Remove favorite":"Add to favorites"} onClick={()=>onToggleFavorite(item.id)} className="rounded-lg px-2 py-1 text-lg text-amber-300">{item.favorite?"★":"☆"}</button>
          </div>
          <div className="border-t border-white/8 bg-black/10 px-3 py-3">
            {latex?<><div className="overflow-x-auto rounded-lg bg-black/10 p-2"><MathView tex={latex}/></div><pre className="mt-2 max-h-16 overflow-auto whitespace-pre-wrap break-words text-[10px] text-slate-400">{latex}</pre></>:<div className="text-xs text-slate-500">No recognition result yet.</div>}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-white/8 p-3">
            <button disabled={!latex} onClick={()=>onCopy(latex)} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">Copy LaTeX</button>
            <button disabled={!latex} onClick={()=>onEditLatex(item.id,0)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-40">LaTeX editor</button>
            <button disabled={!latex} onClick={()=>onEditMathType(item.id,0)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-40">MathType</button>
            <button onClick={()=>{const next=window.prompt("Rename Snip",item.displayName||item.fileName);if(next?.trim())onRename(item.id,next.trim());}} className="ml-auto rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400">Rename</button>
            <button onClick={()=>{if(window.confirm("Delete this Snip and its local source image?"))onDelete(item.id);}} className="rounded-lg border border-rose-500/20 px-3 py-1.5 text-xs text-rose-300">Delete</button>
          </div>
        </article>;
      })}
    </div>
  </div>;
}
