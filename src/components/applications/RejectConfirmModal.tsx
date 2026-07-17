import type { Application } from "../../types";
import { remainingCountsIfRemoved } from "../../store/useApplicationStore";

interface Props {
  app: Application;
  allApplications: Application[];
  onCancel: () => void;
  onConfirm: () => void;
}

export function RejectConfirmModal({ app, allApplications, onCancel, onConfirm }: Props) {
  const remaining = remainingCountsIfRemoved(allApplications, app);
  const zeroedOut = remaining.filter((r) => r.remaining === 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl">
        <h2 className="text-sm font-semibold text-slate-100">
          「{app.bandName}」を却下（削除）しますか？
        </h2>

        {zeroedOut.length > 0 && (
          <div
            className="mt-3 rounded-md border-2 border-red-500 bg-red-950/40 p-3"
            role="alert"
          >
            <p className="text-xs font-semibold text-red-300">
              ⚠️ 警告: このバンドを却下すると、以下のメンバーはライブに一度も出演できなくなります
            </p>
            <ul className="mt-2 list-disc pl-5 text-xs text-red-300">
              {zeroedOut.map((m) => (
                <li key={m.name}>
                  {m.name}（{m.part}）— 他に出演枠なし
                </li>
              ))}
            </ul>
          </div>
        )}

        <ul className="mt-3 space-y-1 text-xs text-slate-400">
          {remaining.map((m) => (
            <li key={m.name}>
              {m.name}（{m.part}）: 却下後の残り出演枠 {m.remaining}
            </li>
          ))}
        </ul>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={
              zeroedOut.length > 0
                ? "rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
                : "rounded bg-slate-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-500"
            }
          >
            {zeroedOut.length > 0 ? "それでも却下する" : "却下する"}
          </button>
        </div>
      </div>
    </div>
  );
}
