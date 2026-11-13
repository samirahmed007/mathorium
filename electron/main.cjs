
const { app, BrowserWindow, globalShortcut, desktopCapturer, screen, ipcMain, nativeImage, clipboard, dialog, shell, Menu, Tray, Notification, protocol, net } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const SCHEME = "mathorium";
let mainWindow = null, tray = null, quitting = false, shortcut = "Control+Alt+M";
const overlays = new Map(), payloads = new Map();

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard:true, secure:true, supportFetchAPI:true, corsEnabled:true, stream:true } }]);

function resources() { return app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), "public"); }
function safePath(root, rel) {
  const full = path.resolve(root, decodeURIComponent(rel || "/").replace(/^[/\\]+/, ""));
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error("Invalid asset path");
  return full;
}
function mime(file) {
  const ext=path.extname(file).toLowerCase();
  return ({".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".wasm":"application/wasm",".onnx":"application/octet-stream",".woff2":"font/woff2"})[ext] || "application/octet-stream";
}
async function installProtocol() {
  protocol.handle(SCHEME, async req => {
    try {
      const u=new URL(req.url); if(u.hostname!=="app") return new Response("Not found",{status:404});
      const p=u.pathname || "/";
      let file;
      if(p.startsWith("/models/")) file=safePath(path.join(resources(),"models"),p.slice(8));
      else if(p.startsWith("/ort/")) file=safePath(path.join(resources(),"ort"),p.slice(5));
      else if(p.startsWith("/ort-hf/")) file=safePath(path.join(resources(),"ort-hf"),p.slice(8));
      else file=safePath(path.join(app.getAppPath(),"dist"),p==="/"?"index.html":p);
      if(!(await fs.promises.stat(file)).isFile()) return new Response("Not found",{status:404});
      const response=await net.fetch(pathToFileURL(file).toString());
      const headers=new Headers(response.headers); headers.set("Content-Type",mime(file)); headers.set("X-Content-Type-Options","nosniff");
      return new Response(response.body,{status:response.status,headers});
    } catch(e) { return new Response(e.message||"Not found",{status:404}); }
  });
}
function iconPath() {
  const choices=[path.join(app.getAppPath(),"dist","icon-512.png"),path.join(app.getAppPath(),"public","icon-512.png")];
  return choices.find(fs.existsSync);
}
function showMain() { if(!mainWindow||mainWindow.isDestroyed()) createMain(); if(mainWindow.isMinimized())mainWindow.restore(); mainWindow.show();mainWindow.focus(); }
function send(channel,payload) { if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send(channel,payload); }
function closeSnips() { for(const w of overlays.values())if(!w.isDestroyed())w.close(); overlays.clear();payloads.clear(); }
function createMain() {
  const icon=iconPath();
  mainWindow=new BrowserWindow({width:1480,height:940,minWidth:1050,minHeight:680,show:false,title:"Mathorium Desktop",backgroundColor:"#0b1020",...(icon?{icon}:{}),webPreferences:{preload:path.join(app.getAppPath(),"electron","preload.cjs"),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  mainWindow.once("ready-to-show",()=>mainWindow.show());
  mainWindow.loadURL("mathorium://app/index.html");
  mainWindow.webContents.setWindowOpenHandler(({url})=>{if(/^https?:/i.test(url))shell.openExternal(url);return {action:"deny"};});
  mainWindow.on("close",e=>{if(!quitting&&process.platform==="win32"){e.preventDefault();mainWindow.hide();}});
  mainWindow.on("closed",()=>mainWindow=null);
}
function registerShortcut(value) {
  const next=String(value||"").trim(); if(!next)return {ok:false,error:"Enter a shortcut."};
  const old=shortcut;if(globalShortcut.isRegistered(old))globalShortcut.unregister(old);
  const ok=globalShortcut.register(next,startCapture);
  if(!ok){globalShortcut.register(old,startCapture);return {ok:false,error:"Shortcut is already registered or unsupported."};}
  shortcut=next;send("desktop:shortcut-status",{ok:true,accelerator:next});return {ok:true,accelerator:next};
}
async function startCapture() {
  if(overlays.size)return;
  if(!mainWindow||mainWindow.isDestroyed())createMain();
  mainWindow.hide();await new Promise(r=>setTimeout(r,180));
  try {
    const displays=screen.getAllDisplays();
    const sources=await desktopCapturer.getSources({types:["screen"],thumbnailSize:{width:4096,height:4096},fetchWindowIcons:false});
    for(const display of displays) {
      const source=sources.find(s=>String(s.display_id)===String(display.id));
      if(!source||source.thumbnail.isEmpty())continue;
      const size=source.thumbnail.getSize();
      const payload={image:"data:image/png;base64,"+source.thumbnail.toPNG().toString("base64"),imageWidth:size.width,imageHeight:size.height,display:{id:display.id,...display.bounds,scaleFactor:display.scaleFactor}};
      const w=new BrowserWindow({x:display.bounds.x,y:display.bounds.y,width:display.bounds.width,height:display.bounds.height,frame:false,transparent:false,backgroundColor:"#0b1020",alwaysOnTop:true,skipTaskbar:true,show:false,resizable:false,webPreferences:{preload:path.join(app.getAppPath(),"electron","preload.cjs"),contextIsolation:true,nodeIntegration:false,sandbox:true}});
      w.setAlwaysOnTop(true,"screen-saver");w.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
      const id=w.webContents.id;overlays.set(id,w);payloads.set(id,payload);
      w.on("closed",()=>{overlays.delete(id);payloads.delete(id);if(!overlays.size&&!quitting)showMain();});
      await w.loadURL("mathorium://app/electron/snipper.html");w.webContents.send("desktop:overlay-init",payload);
    }
    if(!overlays.size)throw new Error("No screen source was available.");
    for(const w of overlays.values())w.show();
  } catch(e) { closeSnips();showMain();new Notification({title:"Mathorium Desktop",body:"Capture failed: "+(e.message||String(e))}).show(); }
}
function completeCapture(data) {
  closeSnips();showMain();
  if(!data||typeof data.dataUrl!=="string"||!data.dataUrl.startsWith("data:image/png;base64,"))return;
  send("desktop:capture-result",{dataUrl:data.dataUrl,fileName:"mathorium-snip-"+Date.now()+".png",display:data.display||null,capturedAt:Date.now()});
}
function modelStatus() {
  const root=path.join(resources(),"models");
  const checks=(dir,files)=>({files:Object.fromEntries(files.map(f=>[f,fs.existsSync(path.join(root,dir,f))])),ready:files.every(f=>fs.existsSync(path.join(root,dir,f)))});
  const pix=checks("pix2text-mfr-quantized",["config.json","generation_config.json","preprocessor_config.json","tokenizer.json","onnx/encoder_model.onnx","onnx/decoder_model.onnx","onnx/decoder_model_int8.onnx"]);
  const tex=checks("texteller-int8",["config.json","generation_config.json","tokenizer.json","tokenizer_config.json","special_tokens_map.json","merges.txt","vocab.json","quantize_config.json","onnx/encoder_model_quantized.onnx","onnx/decoder_model_quantized.onnx"]);
  return {pix2text:pix,texteller:tex,complete:pix.ready&&tex.ready,ortWasm:fs.existsSync(path.join(resources(),"ort","ort-wasm-simd-threaded.wasm"))};
}
function createTray() {
  const p=iconPath(), image=p?nativeImage.createFromPath(p).resize({width:16,height:16}):nativeImage.createEmpty();
  tray=new Tray(image);tray.setToolTip("Mathorium Desktop");
  tray.setContextMenu(Menu.buildFromTemplate([{label:"Open Mathorium",click:showMain},{label:"New Snip",click:startCapture},{label:"Model status",click:()=>{showMain();send("desktop:show-models",modelStatus());}},{type:"separator"},{label:"Exit",click:()=>{quitting=true;app.quit();}}]));
  tray.on("double-click",showMain);
}
function installIpc() {
  ipcMain.handle("desktop:overlay:get",e=>payloads.get(e.sender.id)||null);
  ipcMain.on("desktop:capture:complete",(_e,p)=>completeCapture(p));
  ipcMain.on("desktop:capture:cancel",()=>{closeSnips();showMain();});
  ipcMain.handle("desktop:capture:start",async()=>{await startCapture();return true;});
  ipcMain.handle("desktop:shortcut:set",(_e,v)=>registerShortcut(v));
  ipcMain.handle("desktop:shortcut:get",()=>({accelerator:shortcut,registered:globalShortcut.isRegistered(shortcut)}));
  ipcMain.handle("desktop:models:status",()=>modelStatus());
  ipcMain.handle("desktop:clipboard:write",(_e,t)=>{clipboard.writeText(String(t||""));return true;});
  ipcMain.handle("desktop:dialog:open-images",async()=>{
    const r=await dialog.showOpenDialog(mainWindow,{properties:["openFile","multiSelections"],filters:[{name:"Images",extensions:["png","jpg","jpeg","webp","bmp","tif","tiff"]}]});
    if(r.canceled)return [];
    return r.filePaths.map(p=>{const ext=path.extname(p).toLowerCase(),m=({".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".bmp":"image/bmp",".tif":"image/tiff",".tiff":"image/tiff"})[ext]||"application/octet-stream";return {name:path.basename(p),dataUrl:"data:"+m+";base64,"+fs.readFileSync(p).toString("base64")};});
  });
  ipcMain.handle("desktop:dialog:save-text",async(_e,a)=>{const r=await dialog.showSaveDialog(mainWindow,{defaultPath:a.fileName||"mathorium-export.txt"});if(r.canceled)return false;await fs.promises.writeFile(r.filePath,String(a.content||""),"utf8");return true;});
}
function setMenu() {
  const items=[{label:"File",submenu:[{label:"New Snip",accelerator:"Ctrl+Alt+M",click:startCapture},{label:"Import Images",accelerator:"Ctrl+O",click:()=>send("desktop:import-request")},{type:"separator"},{role:"close"},{label:"Exit",click:()=>{quitting=true;app.quit();}}]},{label:"Edit",submenu:[{role:"undo"},{role:"redo"},{type:"separator"},{role:"cut"},{role:"copy"},{role:"paste"},{role:"selectAll"}]},{label:"View",submenu:[{role:"reload"},{role:"toggleDevTools"},{type:"separator"},{role:"resetZoom"},{role:"zoomIn"},{role:"zoomOut"},{role:"togglefullscreen"}]}];
  Menu.setApplicationMenu(Menu.buildFromTemplate(items));
}
app.whenReady().then(async()=>{await installProtocol();installIpc();createMain();createTray();registerShortcut(shortcut);setMenu();app.on("activate",showMain);});
app.on("will-quit",()=>{globalShortcut.unregisterAll();closeSnips();});
app.on("before-quit",()=>quitting=true);
app.on("window-all-closed",()=>{});
