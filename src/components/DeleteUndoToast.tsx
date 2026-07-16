import { useEffect } from "react";
import { useAppStore } from "../store/useAppStore";

const AUTO_DISMISS_MS = 6000;

export function DeleteUndoToast() {
  const lastDeleted = useAppStore((s) => s.lastDeleted);
  const undoDeleteBand = useAppStore((s) => s.undoDeleteBand);
  const clearLastDeleted = useAppStore((s) => s.clearLastDeleted);

  useEffect(() => {
    if (!lastDeleted) return;
    const timer = window.setTimeout(() => clearLastDeleted(), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [lastDeleted, clearLastDeleted]);

  if (!lastDeleted) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 shadow-lg shadow-black/40">
      <span>「{lastDeleted.band.name}」を削除しました</span>
      <button
        onClick={undoDeleteBand}
        className="rounded bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-500"
      >
        元に戻す
      </button>
      <button
        onClick={clearLastDeleted}
        className="text-slate-500 hover:text-slate-300"
        title="閉じる"
      >
        ×
      </button>
    </div>
  );
}
