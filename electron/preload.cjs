
const { contextBridge, ipcRenderer } = require("electron");
function listen(channel, callback) {
  const fn=(_event,data)=>callback(data);
  ipcRenderer.on(channel,fn);
  return ()=>ipcRenderer.removeListener(channel,fn);
}
contextBridge.exposeInMainWorld("mathoriumDesktop",Object.freeze({
  isDesktop:true,
  isOverlay:location.pathname.endsWith("/snipper.html"),
  startCapture:()=>ipcRenderer.invoke("desktop:capture:start"),
  setGlobalShortcut:value=>ipcRenderer.invoke("desktop:shortcut:set",value),
  getGlobalShortcut:()=>ipcRenderer.invoke("desktop:shortcut:get"),
  getModelStatus:()=>ipcRenderer.invoke("desktop:models:status"),
  chooseImages:()=>ipcRenderer.invoke("desktop:dialog:open-images"),
  saveText:args=>ipcRenderer.invoke("desktop:dialog:save-text",args),
  writeClipboard:text=>ipcRenderer.invoke("desktop:clipboard:write",text),
  onCapture:cb=>listen("desktop:capture-result",cb),
  onImportRequest:cb=>listen("desktop:import-request",cb),
  onAboutRequest:cb=>listen("desktop:about-request",cb),
  onShowModels:cb=>listen("desktop:show-models",cb),
  onShortcutStatus:cb=>listen("desktop:shortcut-status",cb),
  getOverlayCapture:()=>ipcRenderer.invoke("desktop:overlay:get"),
  onOverlayInit:cb=>listen("desktop:overlay-init",cb),
  completeOverlayCapture:data=>ipcRenderer.send("desktop:capture:complete",data),
  cancelOverlayCapture:()=>ipcRenderer.send("desktop:capture:cancel")
}));
