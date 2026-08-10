import { useState } from "react";
import { Popover } from "./Popover";
import { matrixTemplate } from "@/lib/mathlive";
import { cn } from "@/utils/cn";

/**
 * MathType's matrix builder: point at a cell to set the size, pick a fence, insert.
 *
 * The palette can only ever offer the handful of shapes someone thought to write down,
 * and a 6×4 was not one of them — the fixed templates stop at 3×3. Sizing by pointing at
 * the grid is how the desktop app does it, and it covers every shape up to 10×10 without
 * a list. Larger than that, the spinners take over; past ~10 columns the preview grid is
 * wider than the popover and pointing stops being the easier gesture.
 *
 * The fence is a separate choice rather than baked into each template, because "how big"
 * and "which brackets" are independent questions and answering both from one grid of
 * templates is what made the old palette so long.
 */

const FENCES: { env: string; label: string; name: string }[] = [
  { env: "matrix", label: "▦", name: "No brackets" },
  { env: "pmatrix", label: "( )", name: "Parentheses" },
  { env: "bmatrix", label: "[ ]", name: "Brackets" },
  { env: "Bmatrix", label: "{ }", name: "Braces" },
  { env: "vmatrix", label: "| |", name: "Determinant" },
  { env: "Vmatrix", label: "‖ ‖", name: "Norm" },
];

const MAX_PICK = 10;

export function MatrixBuilder({
  open,
  anchor,
  onInsert,
  onClose,
}: {
  open: boolean;
  anchor: HTMLElement | null;
  onInsert: (tex: string) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(2);
  // Bracketless by default. A matrix template's job is the grid; which fence goes round
  // it is a separate decision, and picking parentheses on the user's behalf means the
  // common bare-grid case always needs undoing.
  const [env, setEnv] = useState("matrix");
  // What the grid is showing under the pointer, which is not yet a choice.
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);

  const shownR = hover?.r ?? rows;
  const shownC = hover?.c ?? cols;

  const insert = (r: number, c: number) => {
    onInsert(matrixTemplate(r, c, env));
    onClose();
  };

  return (
    <Popover anchor={anchor} open={open} className="p-2.5">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Insert matrix</div>

      <div
        className="mb-2 grid w-max gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${MAX_PICK}, 1rem)` }}
        onMouseLeave={() => setHover(null)}
      >
        {Array.from({ length: MAX_PICK * MAX_PICK }, (_, i) => {
          const r = Math.floor(i / MAX_PICK) + 1;
          const c = (i % MAX_PICK) + 1;
          const on = r <= shownR && c <= shownC;
          return (
            <button
              key={i}
              onMouseEnter={() => setHover({ r, c })}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setRows(r); setCols(c); insert(r, c); }}
              title={`${r} × ${c}`}
              className={cn(
                "h-4 w-4 rounded-[3px] border transition-colors",
                on ? "border-violet-400/70 bg-violet-500/45" : "border-white/10 bg-white/[0.04] hover:border-white/25",
              )}
            />
          );
        })}
      </div>

      <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-400">
        <span className="tabular-nums text-slate-200">{shownR} × {shownC}</span>
        <Spin label="Rows" value={rows} set={setRows} />
        <Spin label="Cols" value={cols} set={setCols} />
      </div>

      <div className="mb-2 flex flex-wrap gap-1">
        {FENCES.map((f) => (
          <button
            key={f.env}
            title={f.name}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setEnv(f.env)}
            className={cn(
              "h-7 min-w-[34px] rounded-md border px-1.5 text-xs transition-colors",
              env === f.env
                ? "border-violet-400/60 bg-violet-500/25 text-white"
                : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25 hover:text-white",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => insert(rows, cols)}
        className="w-full rounded-lg bg-violet-500/85 px-3 py-1.5 text-xs font-medium text-on-accent transition-colors hover:bg-violet-500"
      >
        Insert {rows} × {cols}
      </button>
    </Popover>
  );
}

/** A number field that also takes the keyboard, for sizes past what the grid offers. */
function Spin({ label, value, set }: { label: string; value: number; set: (n: number) => void }) {
  return (
    <label className="flex items-center gap-1">
      {label}
      <input
        type="number"
        min={1}
        max={20}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n)) set(Math.max(1, Math.min(20, n)));
        }}
        className="h-6 w-11 rounded border border-white/10 bg-[var(--surface-well)] px-1 text-center text-[11px] text-slate-100 focus:border-violet-400/60 focus:outline-none"
      />
    </label>
  );
}
