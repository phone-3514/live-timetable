import { useHistoryStore } from "../store/useHistoryStore";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { ModalPortal } from "./ModalPortal";
import { useProgressStore } from "../store/useProgressStore";

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
  const progressLogs = useProgressStore((s) => s.logs);
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
            className="flex h-9 w-9 items-center justify-center rounded-full text-lg leading-none text-slate-500 hover:bg-slate-700 hover:text-slate-300"
            title="閉じる"
          >
            ×
          </button>
        </div>

        <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
          {progressLogs.length > 0 && (
            <section className="mb-3">
              <h3 className="mb-1 text-[11px] font-semibold text-blue-300">ステージ進行</h3>
              <ul className="space-y-1">
                {[...progressLogs].reverse().slice(0, 20).map((log) => (
                  <li key={log.id} className="rounded border border-blue-900/70 bg-blue-950/20 p-2 text-xs">
                    <span className="flex justify-between gap-2"><strong className="text-slate-200">{log.action}</strong><time className="text-[10px] text-slate-500">{new Date(log.at).toLocaleTimeString("ja-JP")}</time></span>
                    <span className="mt-1 block text-[10px] text-blue-300">{log.actor}</span>
                    <span className="mt-1 block font-mono text-[10px] text-slate-400"><s>{log.before}</s> → <strong className="text-blue-300">{log.after}</strong></span>
                  </li>
                ))}
              </ul>
            </section>
          )}
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
                      className="min-h-11 w-full rounded border border-slate-700 px-2.5 py-2 text-left text-xs text-slate-300 hover:border-blue-500 hover:bg-blue-950/30"
                    >
                      <span className="flex items-center justify-between gap-2"><strong className="text-slate-200">{snapshot.action ?? `${stepsAgo}回前の状態`}</strong><span className="text-[10px] text-slate-500">{new Date(snapshot.at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></span>
                      <span className="mt-1 block text-[10px] text-blue-300">{snapshot.actor ?? "この端末"} ・ クリックしてこの直前へ戻す</span>
                      {snapshot.diffs && snapshot.diffs.length > 0 && (
                        <span className="mt-1.5 block space-y-1 border-t border-slate-700 pt-1.5">
                          {snapshot.diffs.slice(0, 5).map((diff) => (
                            <span key={`${diff.label}-${diff.before}`} className="block text-[10px] text-slate-400"><span className="text-slate-300">{diff.label}</span>：<s>{diff.before}</s> → <strong className="text-blue-300">{diff.after}</strong></span>
                          ))}
                          {snapshot.diffs.length > 5 && <span className="block text-[10px] text-slate-500">ほか{snapshot.diffs.length - 5}件</span>}
                        </span>
                      )}
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
