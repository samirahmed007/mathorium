export {};
declare global {
  interface MathoriumDesktopCapture {
    dataUrl:string;
    fileName:string;
    capturedAt:number;
    display?:{id:number;x:number;y:number;width:number;height:number;scaleFactor:number}|null;
  }
  interface MathoriumDesktopAPI {
    readonly isDesktop:boolean;
    readonly isOverlay:boolean;
    startCapture:()=>Promise<boolean>;
    setGlobalShortcut:(accelerator:string)=>Promise<{ok:boolean;accelerator?:string;error?:string}>;
    getGlobalShortcut:()=>Promise<{accelerator:string;registered:boolean}>;
    getModelStatus:()=>Promise<any>;
    chooseImages:()=>Promise<Array<{name:string;dataUrl:string}>>;
    saveText:(args:{fileName:string;content:string})=>Promise<boolean>;
    writeClipboard:(text:string)=>Promise<boolean>;
    onCapture:(callback:(capture:MathoriumDesktopCapture)=>void)=>()=>void;
    onImportRequest:(callback:()=>void)=>()=>void;
    onAboutRequest:(callback:()=>void)=>()=>void;
    onShowModels:(callback:(status:any)=>void)=>()=>void;
    onShortcutStatus:(callback:(status:any)=>void)=>()=>void;
  }
  interface Window { mathoriumDesktop?:MathoriumDesktopAPI; }
}