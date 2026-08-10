// Type declarations for CDN dynamic imports used in the app.
// These modules are loaded at runtime from esm.sh and are not bundled.

declare module "https://esm.sh/@mlc-ai/web-llm@0.2.78" {
  const mod: any;
  export default mod;
  export const CreateMLCEngine: any;
  export const prebuiltAppConfig: any;
}

// Permissive declaration for all HTTPS CDN imports
declare module "https://*" {
  const _mod: any;
  export default _mod;
  export const pipeline: any;
  export const env: any;
  export const createWorker: any;
  export const convert: any;
}
