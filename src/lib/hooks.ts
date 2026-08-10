import { useEffect, useRef, useState } from "react";

/**
 * useHotkey — register a global keyboard shortcut.
 * Supports: "mod+k" (⌘K on mac, Ctrl+K elsewhere), "shift+l", "g c" (sequence), "?"
 */
export function useHotkey(
  combo: string,
  handler: () => void,
  deps: unknown[] = [],
  opts: { allowInInput?: boolean } = {},
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
    const sequence = combo.includes(" ");
    let firstKey = "";
    let firstKeyTimer: number | null = null;

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName) || target?.isContentEditable;
      if (isInput && !opts.allowInInput) return;

      // sequence (e.g. "g c")
      if (sequence) {
        const [a, b] = combo.split(" ");
        const key = e.key.toLowerCase();
        if (firstKey === a) {
          if (key === b) {
            e.preventDefault();
            handlerRef.current();
            firstKey = "";
            if (firstKeyTimer) clearTimeout(firstKeyTimer);
            return;
          }
        }
        if (key === a && !firstKey) {
          firstKey = a;
          if (firstKeyTimer) clearTimeout(firstKeyTimer);
          firstKeyTimer = window.setTimeout(() => { firstKey = ""; }, 800);
          return;
        }
        return;
      }

      // single combo
      const parts = combo.toLowerCase().split("+").map((p) => p.trim());
      const wantsMod = parts.includes("mod") || parts.includes("cmd") || parts.includes("ctrl");
      const wantsShift = parts.includes("shift");
      const wantsAlt = parts.includes("alt") || parts.includes("option");
      const key = parts[parts.length - 1];

      const modOk = wantsMod ? (isMac ? e.metaKey : e.ctrlKey) : true;
      const shiftOk = wantsShift ? e.shiftKey : !e.shiftKey || wantsShift;
      const altOk = wantsAlt ? e.altKey : true;

      if (wantsMod && !modOk) return;
      if (wantsShift && !shiftOk) return;
      if (wantsAlt && !altOk) return;

      // special: "?" requires shift + "/"
      if (key === "?") {
        if (e.shiftKey && e.key === "?") {
          e.preventDefault();
          handlerRef.current();
          return;
        }
        if (e.shiftKey && e.key === "/") {
          e.preventDefault();
          handlerRef.current();
          return;
        }
        return;
      }

      if (e.key.toLowerCase() === key) {
        e.preventDefault();
        handlerRef.current();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * useLocalStorage — persisted state hook.
 */
export function useLocalStorage<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }, [key, value]);

  return [value, setValue];
}

/**
 * useMediaQuery — track a CSS media query.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

/**
 * useAutoResizeTextarea — auto-resize a textarea to fit its content.
 */
export function useAutoResizeTextarea(value: string, maxRows = 8) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = "auto";
    const lineHeight = parseInt(getComputedStyle(ta).lineHeight) || 20;
    const maxH = lineHeight * maxRows;
    ta.style.height = Math.min(ta.scrollHeight, maxH) + "px";
    ta.style.overflowY = ta.scrollHeight > maxH ? "auto" : "hidden";
  }, [value, maxRows]);
  return ref;
}

/**
 * usePrevious — track the previous value of a state.
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>(undefined);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}
