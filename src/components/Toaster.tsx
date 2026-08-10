import { useEffect } from "react";
import { useStore } from "@/store";
import { cn } from "@/utils/cn";

/**
 * Toaster — premium toast notifications anchored top-right.
 * Driven by the store's `toasts` array; auto-dismisses after duration.
 */
export function Toaster() {
  const { toasts, dismissToast } = useStore();

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={() => dismissToast(t.id)} />
      ))}
    </div>
  );
}

function Toast({ toast, onDismiss }: { toast: import("@/types").ToastMsg; onDismiss: () => void }) {
  useEffect(() => {
    if (!toast.duration) return;
    const t = setTimeout(onDismiss, toast.duration);
    return () => clearTimeout(t);
  }, [toast.duration, onDismiss]);

  const tones: Record<string, string> = {
    default: "border-white/15 bg-[var(--surface-raised)]/95 text-slate-100",
    success: "border-emerald-400/30 bg-emerald-950/90 text-emerald-100",
    error: "border-rose-400/30 bg-rose-950/90 text-rose-100",
    warning: "border-amber-400/30 bg-amber-950/90 text-amber-100",
    info: "border-sky-400/30 bg-sky-950/90 text-sky-100",
  };
  const icons: Record<string, string> = {
    default: "•",
    success: "✓",
    error: "⚠",
    warning: "⚠",
    info: "ℹ",
  };

  return (
    <div
      className={cn(
        "pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 shadow-xl backdrop-blur-md",
        "animate-[toastIn_.22s_cubic-bezier(.16,1,.3,1)]",
        tones[toast.tone || "default"],
      )}
      role="status"
    >
      <span className="mt-0.5 text-sm">{icons[toast.tone || "default"]}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold leading-snug">{toast.title}</div>
        {toast.description && (
          <div className="mt-0.5 text-[12px] leading-snug opacity-90">{toast.description}</div>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="ml-1 shrink-0 rounded p-0.5 text-xs opacity-60 hover:bg-white/10 hover:opacity-100"
        aria-label="Dismiss"
      >
        ✕
      </button>
      <style>{`@keyframes toastIn{from{opacity:0;transform:translateX(20px) scale(.96)}to{opacity:1;transform:translateX(0) scale(1)}}`}</style>
    </div>
  );
}
