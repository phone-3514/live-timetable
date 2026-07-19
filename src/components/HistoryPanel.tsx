import { useHistoryStore } from "../store/useHistoryStore";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { ModalPortal } from "./ModalPortal";

interface Props {
  onClose: () => void;
}

// The "click any point in the past to jump straight back to it" panel —
// deliberately a flat chronological list, not a full branching tree
// (see useHistoryStore's doc comment for why): every past checkpoint is
// still individually reachable, just not as a graph you can branch off of
// mid-history.
export function HistoryPanel({ onClose }: Props) {
  const past = useHistoryStore((s) => s.past);
  const jumpToPast = useHistoryStore((s) => s.jumpToPast);
  useEscapeKey(onClose);

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-20"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[70vh] w-full max-w-sm flex-col rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-100">操作履歴</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-lg leading-none text-slate-500 hover:bg-slate-800 hover:text-slate-300"
            title="閉じる"
          >
            ×
          </button>
        </div>

        <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
          {past.length === 0 ? (
            <p className="rounded-md border border-slate-700 px-3 py-6 text-center text-xs text-slate-500">
              まだ配置の変更履歴がありません
            </p>
          ) : (
            <ul className="space-y-1">
              {[...past].reverse().map((snapshot, reverseIndex) => {
                const index = past.length - 1 - reverseIndex;
                const stepsAgo = past.length - index;
                return (
                  <li key={snapshot.at}>
                    <button
                      type="button"
                      onClick={() => {
                        jumpToPast(index);
                        onClose();
                      }}
                      className="flex min-h-11 w-full items-center justify-between rounded border border-slate-700 px-2.5 text-left text-xs text-slate-300 hover:border-indigo-500 hover:bg-indigo-950/30 md:min-h-0 md:py-1.5"
                    >
                      <span>{stepsAgo}回前の状態に戻す</span>
                      <span className="text-[10px] text-slate-500">
                        {new Date(snapshot.at).toLocaleTimeString("ja-JP", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
