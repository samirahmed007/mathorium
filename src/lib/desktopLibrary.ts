import type { ConvertResult } from "@/types";

const DB_NAME="mathorium-desktop-library";
const STORE_NAME="snips";
let dbPromise:Promise<IDBDatabase>|null=null;
function openDb():Promise<IDBDatabase>{
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    if(!("indexedDB" in window)){reject(new Error("IndexedDB is unavailable"));return;}
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(STORE_NAME)){
        const store=db.createObjectStore(STORE_NAME,{keyPath:"id"});
        store.createIndex("createdAt","createdAt",{unique:false});
      }
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error("Could not open local Snip Library"));
  });
  return dbPromise;
}
export async function loadDesktopLibrary():Promise<ConvertResult[]>{
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE_NAME,"readonly"),req=tx.objectStore(STORE_NAME).getAll();
    req.onsuccess=()=>resolve((req.result as ConvertResult[]).sort((a,b)=>b.createdAt-a.createdAt));
    req.onerror=()=>reject(req.error||new Error("Could not read Snip Library"));
  });
}
export async function saveDesktopLibrary(items:ConvertResult[]):Promise<void>{
  const db=await openDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE_NAME,"readwrite"),store=tx.objectStore(STORE_NAME);
    store.clear();
    for(const item of items)store.put(item);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error||new Error("Could not save Snip Library"));
    tx.onabort=()=>reject(tx.error||new Error("Snip Library save was cancelled"));
  });
}
export async function exportDesktopLibraryBackup(items:ConvertResult[]):Promise<Blob>{
  return new Blob([JSON.stringify({schema:1,createdAt:new Date().toISOString(),items},null,2)],{type:"application/json"});
}
