import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// Global error handlers — suppress service worker SecurityError on file://
if (typeof window !== "undefined") {
  window.addEventListener("error", (e) => {
    if (e.message && e.message.includes("serviceWorker")) {
      e.preventDefault();
      return;
    }
    if (e.message && e.message.includes("SecurityError")) {
      e.preventDefault();
      return;
    }
  });
  window.addEventListener("unhandledrejection", (e) => {
    const msg = String(e.reason || "");
    if (msg.includes("serviceWorker") || msg.includes("SecurityError")) {
      e.preventDefault();
    }
  });
}

// Register service worker for offline support — only in secure contexts.
// Triple-guarded against file:// protocol crashes.
function registerSW() {
  try {
    if (typeof window === "undefined") return;
    if (location.protocol !== "http:" && location.protocol !== "https:") return;
    if (!window.isSecureContext) return;
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {
        /* SW registration failure is non-fatal */
      });
    });
  } catch {
    /* ignore */
  }
}
registerSW();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
