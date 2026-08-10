import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * ErrorBoundary — catches render errors and shows a recovery UI instead of a
 * blank white screen. Includes a "Reload" button and (in dev) the stack trace.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false, error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Mathorium crash:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    location.reload();
  };

  handleReset = () => {
    try {
      ["mathforge.state.v4", "mathforge.schema"].forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
    location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    const { error, errorInfo } = this.state;
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--surface-app)] p-6 text-slate-200">
        <div className="max-w-lg rounded-2xl border border-rose-500/30 bg-rose-950/30 p-6 shadow-2xl">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/20 text-xl">💥</div>
            <div>
              <h2 className="text-lg font-semibold text-white">Mathorium crashed</h2>
              <p className="text-xs text-slate-400">An unexpected error occurred. Your data is safe in localStorage.</p>
            </div>
          </div>
          <div className="mt-4 rounded-lg border border-white/10 bg-black/40 p-3">
            <div className="font-mono text-[12px] text-rose-300">{error?.message || "Unknown error"}</div>
            {errorInfo?.componentStack && (
              <pre className="mt-2 max-h-40 overflow-auto font-mono text-[10px] leading-snug text-slate-500">{errorInfo.componentStack}</pre>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={this.handleReload}
              className="rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 px-4 py-2 text-sm font-semibold text-on-accent hover:from-violet-400 hover:to-indigo-500"
            >
              ↻ Reload app
            </button>
            <button
              onClick={this.handleReset}
              className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-300 hover:bg-rose-500/20"
            >
              Reset all data
            </button>
          </div>
        </div>
      </div>
    );
  }
}
