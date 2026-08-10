import { type ButtonHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes, useEffect } from "react";
import { cn } from "@/utils/cn";

type Variant = "primary" | "ghost" | "subtle" | "danger" | "outline" | "success";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary:
    "bg-gradient-to-br from-violet-500 to-indigo-600 text-on-accent hover:from-violet-400 hover:to-indigo-500 shadow-lg shadow-indigo-900/40",
  success: "bg-gradient-to-br from-emerald-500 to-teal-600 text-on-accent hover:from-emerald-400 hover:to-teal-500",
  ghost: "text-slate-300 hover:bg-white/5 hover:text-white",
  subtle: "bg-white/5 text-slate-200 hover:bg-white/10 border border-white/5",
  outline: "border border-white/15 text-slate-200 hover:bg-white/5 hover:border-white/25",
  danger: "bg-rose-600/90 text-on-accent hover:bg-rose-500",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-6 text-base gap-2 rounded-xl",
  icon: "h-9 w-9 rounded-lg justify-center",
};

export function Button({
  variant = "subtle",
  size = "md",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={cn(
        "mf-btn inline-flex items-center justify-center font-medium transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Badge({ children, className, tone = "default" }: { children: ReactNode; className?: string; tone?: "default" | "green" | "amber" | "blue" | "rose" }) {
  const tones = {
    default: "bg-white/8 text-slate-300 border-white/10",
    green: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
    amber: "bg-amber-500/15 text-amber-300 border-amber-500/25",
    blue: "bg-sky-500/15 text-sky-300 border-sky-500/25",
    rose: "bg-rose-500/15 text-rose-300 border-rose-500/25",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-[fadeIn_.15s_ease]" onClick={onClose} />
      <div className={cn("relative z-10 w-full rounded-2xl border border-white/10 bg-[var(--surface-modal)] shadow-2xl shadow-black/60 animate-[popIn_.18s_ease] flex max-h-[90vh] flex-col", wide ? "max-w-4xl" : "max-w-lg")}>
        {title && (
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
            <div className="font-semibold text-white">{title}</div>
            <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        )}
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-white/10 px-5 py-3.5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2.5 select-none">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cn("relative h-6 w-11 rounded-full transition-colors", checked ? "bg-gradient-to-r from-violet-500 to-indigo-500" : "bg-white/10")}
      >
        <span className={cn("absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-on-accent shadow transition-transform", checked && "translate-x-5")} />
      </button>
      {label && <span className="text-sm text-slate-300">{label}</span>}
    </label>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-slate-400">{label}</span>
        {hint && <span className="text-[10px] text-slate-500">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-xl border border-white/10 bg-[var(--surface-well)] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-violet-400/60 focus:outline-none focus:ring-2 focus:ring-violet-500/20 transition";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputCls, props.className)} />;
}
export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(inputCls, "resize-y font-mono leading-relaxed", props.className)} />;
}
export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn(inputCls, "appearance-none cursor-pointer pr-8", props.className)}>
      {children}
    </select>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className)} width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// Animated 3-dot typing indicator (premium chatbot feel).
export function TypingDots({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-slate-400"
          style={{ animation: `mfTyping 1.2s ${i * 0.18}s infinite ease-in-out` }}
        />
      ))}
      <style>{`@keyframes mfTyping{0%,60%,100%{opacity:.25;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}`}</style>
    </span>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl border border-white/8 bg-[var(--surface-card)]", className)}>{children}</div>;
}
