import { useState } from "react";
import { MathView } from "./MathView";
import { Popover } from "./Popover";
import { SHORTCUT_BY_TEX, type MathGroup, type MathItem } from "@/lib/mathTypePalettes";
import { cn } from "@/utils/cn";

/**
 * The chrome shared by the standalone MathType tab. Originally there was also a modal
 * MathTypeEditor, but that was removed in v8.2 — the tab is the only surface now, and
 * these parts stay factored out to keep the tab's render lean.
 */

export function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500", className)}>{children}</div>;
}

export function IconBtn({
  children,
  title,
  onClick,
  active,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-7 w-7 rounded-md text-sm transition-colors disabled:opacity-30 disabled:pointer-events-none",
        active ? "bg-violet-500/25 text-violet-200" : "text-slate-400 hover:bg-white/8 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

export type MenuItem = {
  label?: string;
  hint?: string;
  onClick?: () => void;
  sep?: boolean;
  check?: boolean;
  disabled?: boolean;
};

export function Menu({
  name,
  items,
  open,
  setOpen,
}: {
  name: string;
  items: MenuItem[];
  open: string | null;
  setOpen: (v: string | null) => void;
}) {
  const isOpen = open === name;
  const [btn, setBtn] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        ref={setBtn}
        onClick={() => setOpen(isOpen ? null : name)}
        // Hovering across the bar switches menus once one is open, the way a real
        // menu bar behaves — but hovering does not *open* the first one.
        onMouseEnter={() => open && setOpen(name)}
        className={cn(
          "rounded-md px-2.5 py-1 transition-colors",
          isOpen ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
        )}
      >
        {name}
      </button>
      <Popover anchor={btn} open={isOpen} className="min-w-[230px] py-1 text-xs">
        {items.map((it, i) =>
          it.sep ? (
            <div key={i} className="my-1 h-px bg-white/8" />
          ) : (
            <button
              key={i}
              onClick={() => { it.onClick?.(); setOpen(null); }}
              disabled={it.disabled}
              className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-slate-300 hover:bg-violet-500/20 hover:text-white disabled:opacity-35 disabled:pointer-events-none"
            >
              <span className="w-3 text-violet-300">{it.check ? "✓" : ""}</span>
              <span className="flex-1 whitespace-nowrap">{it.label}</span>
              {it.hint && <span className="text-[10px] text-slate-500">{it.hint}</span>}
            </button>
          ),
        )}
      </Popover>
    </>
  );
}

export function Ribbon({
  groups,
  openGroup,
  setOpenGroup,
  onPick,
  className,
}: {
  groups: MathGroup[];
  openGroup: string | null;
  setOpenGroup: (v: string | null) => void;
  onPick: (tex: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {groups.map((gr) => (
        <RibbonGroup
          key={gr.name}
          group={gr}
          open={openGroup === gr.name}
          setOpenGroup={setOpenGroup}
          onPick={onPick}
        />
      ))}
    </div>
  );
}

function RibbonGroup({
  group: gr,
  open,
  setOpenGroup,
  onPick,
}: {
  group: MathGroup;
  open: boolean;
  setOpenGroup: (v: string | null) => void;
  onPick: (tex: string) => void;
}) {
  const [btn, setBtn] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        ref={setBtn}
        title={gr.name}
        onClick={() => setOpenGroup(open ? null : gr.name)}
        className={cn(
          "flex h-8 min-w-[46px] items-center justify-center gap-1 rounded-lg border px-2 text-sm transition-colors",
          open
            ? "border-violet-400/50 bg-violet-500/20 text-white"
            : "border-white/8 bg-white/[0.03] text-slate-300 hover:border-white/15 hover:bg-white/8 hover:text-white",
        )}
      >
        <span className="leading-none">{gr.icon}</span>
        <span className="text-[8px] leading-none text-slate-500">▼</span>
      </button>
      <Popover anchor={btn} open={open} className="p-2">
        <div className="mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{gr.name}</div>
        {/* Fixed-width columns rather than fractions. `minmax(0,1fr)` let each cell
            collapse to whatever the shrink-to-fit popover gave it, which is what
            crushed the glyphs into an unreadable smear. */}
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${gr.cols || 6}, 2.25rem)` }}>
          {gr.items.map((it, i) => (
            <PaletteButton key={i} item={it} onPick={onPick} />
          ))}
        </div>
      </Popover>
    </>
  );
}

export function PaletteButton({ item, onPick, wide }: { item: MathItem; onPick: (tex: string) => void; wide?: boolean }) {
  // A palette button and a shortcut that insert the same template are the same command,
  // so the button is where the key gets advertised — nobody reads a shortcut list.
  const key = SHORTCUT_BY_TEX.get(item.tex);
  const title = `${item.name || item.tex}${key ? `  (${key})` : ""}`;
  return (
    <button
      title={title}
      onMouseDown={(e) => e.preventDefault()} // keep the mathfield's caret where it is
      onClick={() => onPick(item.tex)}
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-lg border border-white/8 bg-white/[0.03] text-slate-200 transition-colors hover:border-violet-400/40 hover:bg-violet-500/15 hover:text-white",
        // Symbol cells are sized to the grid track they sit in, so a dense palette
        // stays a clean lattice instead of each glyph setting its own width.
        wide ? "min-h-[38px] px-2 py-1.5" : "h-9 w-9 p-0",
      )}
    >
      {item.render ? <MathView tex={item.label} display={false} className="text-[13px]" /> : <span className="text-sm leading-none">{item.label}</span>}
      {/* A corner dot marks the templates that also have a key, so they can be spotted
          without hovering every cell to find out. */}
      {key && <span className="absolute right-0.5 top-0.5 h-1 w-1 rounded-full bg-violet-400/70" />}
    </button>
  );
}
