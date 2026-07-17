import { useMemo, useState } from "react";
import type { MemberFrameCount } from "../../store/useApplicationStore";
import { useApplicationStore } from "../../store/useApplicationStore";
import { findNearDuplicateNames } from "../../utils/nameResolution";
import { useEscapeKey } from "../../hooks/useEscapeKey";

interface Props {
  frameCounts: Map<string, MemberFrameCount>;
  onClose: () => void;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

export function NameResolutionModal({ frameCounts, onClose }: Props) {
  const mergeMemberName = useApplicationStore((s) => s.mergeMemberName);
  // Dismissed pairs are session-local (cleared on next reopen) — actually
  // merging removes a pair permanently since one of its two keys stops
  // existing in frameCounts; "keep separate" is a softer "not right now",
  // not a permanent decision worth persisting.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  useEscapeKey(onClose);

  const pairs = useMemo(() => findNearDuplicateNames(frameCounts), [frameCounts]);
  const visiblePairs = pairs.filter((p) => !dismissed.has(pairKey(p.nameA, p.nameB)));

  function handleMerge(keep: string, discard: string) {
    mergeMemberName(discard, keep);
  }

  function handleKeepSeparate(a: string, b: string) {
    setDismissed((prev) => new Set(prev).add(pairKey(a, b)));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">似た名前の確認</h2>
            <p className="mt-1 text-xs text-slate-400">
              タイプミスで同じ人が別人として集計されている可能性がある組み合わせです。同一人物であれば統合してください。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg leading-none text-slate-500 hover:bg-slate-800 hover:text-slate-300"
            title="閉じる"
          >
            ×
          </button>
        </div>

        <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
          {visiblePairs.length === 0 && (
            <p className="rounded-md border border-slate-700 px-3 py-6 text-center text-xs text-slate-500">
              類似する名前の組み合わせはありません
            </p>
          )}
          {visiblePairs.map((pair) => {
            const countA = frameCounts.get(pair.nameA)?.count ?? 0;
            const countB = frameCounts.get(pair.nameB)?.count ?? 0;
            return (
              <div
                key={pairKey(pair.nameA, pair.nameB)}
                className="rounded-md border border-amber-700 bg-amber-950/20 p-3"
              >
                <p className="text-xs text-amber-300">
                  「{pair.nameA}」（{countA}件）と「{pair.nameB}」（{countB}件）は同一人物ですか？
                  <span className="ml-1 text-amber-500">（差分{pair.distance}文字）</span>
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleMerge(pair.nameA, pair.nameB)}
                    className="min-h-9 rounded border border-emerald-600 bg-emerald-950/40 px-2 text-xs font-medium text-emerald-300 hover:bg-emerald-900/50"
                  >
                    「{pair.nameA}」に統合
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMerge(pair.nameB, pair.nameA)}
                    className="min-h-9 rounded border border-emerald-600 bg-emerald-950/40 px-2 text-xs font-medium text-emerald-300 hover:bg-emerald-900/50"
                  >
                    「{pair.nameB}」に統合
                  </button>
                  <button
                    type="button"
                    onClick={() => handleKeepSeparate(pair.nameA, pair.nameB)}
                    className="min-h-9 rounded border border-slate-600 px-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
                  >
                    別人として区別
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex shrink-0 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded border border-slate-600 px-4 text-sm font-medium text-slate-300 hover:bg-slate-800 sm:min-h-0 sm:py-1.5 sm:text-xs"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
