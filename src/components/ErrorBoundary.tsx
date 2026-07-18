import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Shown above the error message — lets the same component read as
   * either "the whole app crashed" (root use) or "just this widget
   * crashed" (e.g. wrapping the collaboration feature only) depending on
   * where it's mounted. */
  title: string;
  /** When true, renders a minimal inline fallback instead of a full-page
   * one — for a boundary wrapping a small piece of UI (like CollabRoot)
   * where the rest of the app should stay fully usable. */
  inline?: boolean;
}

interface State {
  error: Error | null;
}

// React Error Boundaries have no hook equivalent — this must be a class
// component (getDerivedStateFromError/componentDidCatch are class-only
// lifecycle APIs). Catches render/lifecycle errors in its subtree and
// shows the exact error message instead of leaving a blank screen — see
// project memory for the incident this exists to prevent: an uncaught
// fatal Firebase RTDB init error took down the entire app with nothing
// to stop it.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary: ${this.props.title}]`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.inline) {
      return (
        <div className="rounded border border-rose-700 bg-rose-950/40 px-2.5 py-1.5 text-xs text-rose-300">
          ⚠️ {this.props.title}でエラーが発生しました: {error.message}
        </div>
      );
    }

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-950 p-6 text-center">
        <p className="text-lg font-semibold text-rose-400">⚠️ {this.props.title}</p>
        <p className="max-w-xl rounded border border-slate-700 bg-slate-900 px-4 py-3 font-mono text-xs text-slate-300">
          {error.message}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-11 rounded bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 sm:min-h-0 sm:py-1.5"
        >
          ページを再読み込み
        </button>
      </div>
    );
  }
}
