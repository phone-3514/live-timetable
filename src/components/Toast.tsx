import { useEffect } from "react";
import { useToastStore } from "../store/useToastStore";

const AUTO_DISMISS_MS = 4500;

const TONE_CLASSES: Record<string, string> = {
  success: "border-emerald-600 bg-emerald-950/90 text-emerald-200",
  info: "border-indigo-600 bg-indigo-950/90 text-indigo-200",
  error: "border-red-600 bg-red-950/90 text-red-200",
};

export function Toast() {
  const message = useToastStore((s) => s.message);
  const tone = useToastStore((s) => s.tone);
  const clear = useToastStore((s) => s.clear);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => clear(), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [message, clear]);

  if (!message) return null;

  return (
    <div
      role="status"
      className={`fixed left-1/2 top-4 z-[100] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-lg border px-4 py-2.5 text-sm shadow-lg shadow-black/40 sm:w-auto ${TONE_CLASSES[tone]}`}
    >
      <span className="min-w-0 flex-1">{message}</span>
      <button
        onClick={clear}
        className="flex h-9 w-9 shrink-0 items-center justify-center text-current opacity-70 hover:opacity-100 sm:h-auto sm:w-auto"
        title="閉じる"
      >
        ×
      </button>
    </div>
  );
}
