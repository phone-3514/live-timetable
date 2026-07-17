import { useMemo } from "react";
import {
  computeGearConflictDetails,
  computeMemberSchedules,
  useAppStore,
} from "../store/useAppStore";

interface Props {
  onClose: () => void;
}

// Final-review dashboard for the two things that are easy to miss scanning
// a long timetable one day-column at a time: members double-booked back to
// back (computeMemberSchedules), and bands sharing physical gear back to
// back (computeGearConflictDetails). Both computations already run inline
// per-day for the red/amber slot highlights — this aggregates the same
// underlying checks into one list instead of requiring a scroll-through.
export function ScheduleReviewModal({ onClose }: Props) {
  const bands = useAppStore((s) => s.bands);
  const days = useAppStore((s) => s.days);

  const memberSchedules = useMemo(() => computeMemberSchedules(bands, days), [bands, days]);
  const gearConflicts = useMemo(() => computeGearConflictDetails(days, bands), [days, bands]);

  const conflictMemberCount = memberSchedules.filter((m) => m.hasAdjacentConflict).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">スケジュール確認</h2>
            <p className="mt-1 text-xs text-slate-400">
              配置を確定する前に、掛け持ちメンバーと機材の競合をまとめて確認できます。
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

        <div className="mt-4 min-h-0 flex-1 space-y-5 overflow-y-auto">
          <section>
            <h3 className="text-xs font-semibold text-slate-300">
              👥 メンバーの掛け持ち状況
              {conflictMemberCount > 0 && (
                <span className="ml-2 rounded-full bg-rose-950/60 px-2 py-0.5 text-[11px] font-semibold text-rose-300">
                  連続枠 {conflictMemberCount}名
                </span>
              )}
            </h3>
            {memberSchedules.length === 0 ? (
              <p className="mt-2 rounded-md border border-slate-700 px-3 py-4 text-center text-xs text-slate-500">
                2バンド以上を掛け持ちしているメンバーはいません
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {memberSchedules.map((m) => (
                  <li
                    key={m.name}
                    className={`rounded-md border p-2.5 ${
                      m.hasAdjacentConflict
                        ? "border-rose-700 bg-rose-950/20"
                        : "border-slate-700 bg-slate-800/50"
                    }`}
                  >
                    <p className="text-xs font-semibold text-slate-200">
                      {m.name}
                      <span className="ml-1.5 font-normal text-slate-500">
                        （{m.entries.length}バンド）
                      </span>
                      {m.hasAdjacentConflict && (
                        <span className="ml-1.5 text-[11px] font-medium text-rose-400">
                          ⚠ 転換時間なしで連続する枠があります
                        </span>
                      )}
                    </p>
                    <ul className="mt-1 space-y-0.5 text-[11px] text-slate-400">
                      {m.entries.map((e) => (
                        <li key={e.bandId}>
                          {e.dayLabel ? (
                            <>
                              {e.dayLabel} {e.startTime}-{e.endTime}
                            </>
                          ) : (
                            <span className="text-amber-400">未配置</span>
                          )}
                          <span className="ml-1.5 text-slate-300">{e.bandName}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="text-xs font-semibold text-slate-300">
              ⚙ 機材の競合
              {gearConflicts.length > 0 && (
                <span className="ml-2 rounded-full bg-amber-950/60 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                  {gearConflicts.length}件
                </span>
              )}
            </h3>
            {gearConflicts.length === 0 ? (
              <p className="mt-2 rounded-md border border-slate-700 px-3 py-4 text-center text-xs text-slate-500">
                連続する枠での機材タグの重複はありません
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {gearConflicts.map((c, i) => (
                  <li
                    key={i}
                    className="rounded-md border border-amber-700 bg-amber-950/20 p-2.5 text-xs"
                  >
                    <p className="font-semibold text-slate-200">
                      {c.dayLabel}：{c.bandAName} → {c.bandBName}
                    </p>
                    <p className="mt-1 text-[11px] text-amber-300">
                      共有タグ: {c.sharedTags.join("、")}（転換時間 {c.transitionMinutes}分）
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="mt-5 flex shrink-0 justify-end">
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
