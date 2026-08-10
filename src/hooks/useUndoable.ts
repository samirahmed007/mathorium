import { useCallback, useRef, useState } from "react";

/**
 * Undo/redo history for a single editable value.
 *
 * The browser gives a `<textarea>` its own undo stack for free, but it is useless
 * here for two reasons: a React-controlled value loses the native history the moment
 * state is set programmatically, and — more importantly — half the edits in these
 * editors never pass through the keyboard at all. Clicking `\frac{}{}` in a palette,
 * converting pasted MathML, applying a MathType edit: all of those rewrite the
 * document without the browser noticing, so native Ctrl+Z would skip straight past
 * them to whatever was last typed. A single explicit history over the value itself is
 * the only way Ctrl+Z can mean "undo the last thing I did" regardless of how I did it.
 *
 * Consecutive edits within `coalesceMs` collapse into one entry, so undoing a typed
 * word takes one keystroke rather than one per character. Anything that isn't typing
 * passes `checkpoint: true` and always gets its own entry.
 */

export interface UndoableApi<T> {
  value: T;
  /** Record an edit. Pass `checkpoint` for discrete actions that must not coalesce. */
  set: (next: T | ((prev: T) => T), opts?: { checkpoint?: boolean }) => void;
  /** Replace the value and discard the history — a different document, not an edit. */
  reset: (next: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useUndoable<T>(
  initial: T,
  { limit = 200, coalesceMs = 600 }: { limit?: number; coalesceMs?: number } = {},
): UndoableApi<T> {
  const [state, setState] = useState<{ past: T[]; present: T; future: T[] }>({
    past: [],
    present: initial,
    future: [],
  });
  // Timestamp of the last recorded edit, used only to decide whether the next one
  // continues the same burst of typing.
  const lastEdit = useRef(0);

  const set = useCallback(
    (next: T | ((prev: T) => T), opts?: { checkpoint?: boolean }) => {
      setState((s) => {
        const value = typeof next === "function" ? (next as (p: T) => T)(s.present) : next;
        if (Object.is(value, s.present)) return s;
        const now = Date.now();
        // Keep the previous value only when this edit starts a new burst. The very
        // first edit always pushes, otherwise there would be nothing to undo *to*.
        const coalesce = !opts?.checkpoint && s.past.length > 0 && now - lastEdit.current < coalesceMs;
        lastEdit.current = now;
        const past = coalesce ? s.past : [...s.past, s.present];
        return {
          past: past.length > limit ? past.slice(past.length - limit) : past,
          present: value,
          future: [],
        };
      });
    },
    [coalesceMs, limit],
  );

  const reset = useCallback((next: T) => {
    lastEdit.current = 0;
    setState({ past: [], present: next, future: [] });
  }, []);

  const undo = useCallback(() => {
    // Reset the burst clock: the edit *after* an undo must start its own entry,
    // otherwise it would silently overwrite the state we just stepped back to.
    lastEdit.current = 0;
    setState((s) => {
      if (!s.past.length) return s;
      return {
        past: s.past.slice(0, -1),
        present: s.past[s.past.length - 1],
        future: [s.present, ...s.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    lastEdit.current = 0;
    setState((s) => {
      if (!s.future.length) return s;
      return {
        past: [...s.past, s.present],
        present: s.future[0],
        future: s.future.slice(1),
      };
    });
  }, []);

  return {
    value: state.present,
    set,
    reset,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}

/**
 * True when a keyboard event is the platform's undo or redo gesture.
 *
 * Redo has two spellings and both are in active use — Ctrl+Y on Windows, Ctrl+Shift+Z
 * everywhere else — so both are accepted on every platform rather than guessing from
 * the user agent.
 */
export function undoRedoIntent(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): "undo" | "redo" | null {
  if (!e.ctrlKey && !e.metaKey) return null;
  const k = e.key.toLowerCase();
  if (k === "z") return e.shiftKey ? "redo" : "undo";
  if (k === "y") return "redo";
  return null;
}
