import { useEffect } from "react";
import { useHistoryStore } from "../store/useHistoryStore";

const AUTO_DISMISS_MS = 6000;

type Props = {
  notice: { id: number; message: string } | null;
  onClose: () => void;
};

export function MoveUndoToast({ notice, onClose }: Props) {
  const undo = useHistoryStore((state) => state.undo);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(onClose, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [notice, onClose]);

  if (!notice) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-[110] flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 items-center gap-2 rounded-xl border border-slate-600 bg-slate-900/95 px-3 py-2 text-sm text-slate-100 shadow-2xl shadow-black/50 backdrop-blur-lg sm:w-auto"
    >
      <span className="min-w-0 flex-1 truncate">{notice.message}</span>
      <button
        type="button"
        onClick={() => {
          undo();
          onClose();
        }}
        className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-bold text-blue-300 hover:bg-slate-800 hover:text-blue-200 sm:min-h-9"
      >
        元に戻す
      </button>
      <button
        type="button"
        onClick={onClose}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-lg text-slate-500 hover:bg-slate-800 hover:text-slate-200 sm:h-9 sm:w-9"
        aria-label="通知を閉じる"
      >
        ×
      </button>
    </div>
  );
}
