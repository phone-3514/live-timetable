import { useMemo } from "react";
import {
  computeConcentrationSummary,
  computeGearConflictDetails,
  computeMemberBlockBreakdown,
  computeMemberSchedules,
  formatConcentrationMessage,
  useAppStore,
  type ConcentrationSummaryEntry,
  type MemberBlockUsage,
  type MemberSchedule,
} from "../store/useAppStore";
import { normalizeMemberName } from "../utils/normalizeMemberName";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { ModalPortal } from "./ModalPortal";

interface Props {
  onClose: () => void;
}

type MergedMemberRow = MemberSchedule & {
  concentrationEntries: ConcentrationSummaryEntry[];
  blocks: MemberBlockUsage[];
};

// Consecutive-performance warnings (red, physically impossible) always
// rank above concentration warnings (amber, just an unpleasant day) above
// no warning at all — so the organizer sees the must-fix rows first
// without scrolling past everyone else to find them.
function priorityTier(m: MergedMemberRow): number {
  if (m.hasAdjacentConflict) return 0;
  if (m.concentrationEntries.length > 0) return 1;
  return 2;
}

// Final-review dashboard for the things that are easy to miss scanning a
// long timetable one day-column at a time: members double-booked back to
// back or with their whole day crammed into one block (both computed
// inline per-day for the slot highlights — this aggregates the same
// underlying checks into one sorted list instead of a scroll-through),
// and bands sharing physical gear back to back.
export function ScheduleReviewModal({ onClose }: Props) {
  const bands = useAppStore((s) => s.bands);
  const days = useAppStore((s) => s.days);
  useEscapeKey(onClose);

  const isSingleDay = days.length === 1;
  const memberSchedules = useMemo(() => computeMemberSchedules(bands, days), [bands, days]);
  const gearConflicts = useMemo(() => computeGearConflictDetails(days, bands), [days, bands]);
  const concentrationSummary = useMemo(
    () => computeConcentrationSummary(days, bands),
    [days, bands],
  );
  const blockBreakdown = useMemo(
    () => computeMemberBlockBreakdown(days, bands),
    [days, bands],
  );

  const mergedMembers = useMemo(() => {
    const rows: MergedMemberRow[] = memberSchedules.map((m) => {
      const key = normalizeMemberName(m.name);
      return {
        ...m,
        concentrationEntries: concentrationSummary.filter(
          (c) => normalizeMemberName(c.memberName) === key,
        ),
        blocks: blockBreakdown.get(key) ?? [],
      };
    });
    return rows.sort((a, b) => {
      const tierDiff = priorityTier(a) - priorityTier(b);
      if (tierDiff !== 0) return tierDiff;
      return b.entries.length - a.entries.length;
    });
  }, [memberSchedules, concentrationSummary, blockBreakdown]);

  const conflictMemberCount = memberSchedules.filter((m) => m.hasAdjacentConflict).length;
  const concentrationMemberCount = mergedMembers.filter(
    (m) => !m.hasAdjacentConflict && m.concentrationEntries.length > 0,
  ).length;

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
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
              {concentrationMemberCount > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-950/60 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                  集中 {concentrationMemberCount}名
                </span>
              )}
            </h3>
            <p className="mt-1 text-[11px] text-slate-500">
              連続枠（赤・最優先）→ 出番集中（黄・優先）→ 通常の順で表示しています。
            </p>
            {mergedMembers.length === 0 ? (
              <p className="mt-2 rounded-md border border-slate-700 px-3 py-4 text-center text-xs text-slate-500">
                2バンド以上を掛け持ちしているメンバーはいません
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {mergedMembers.map((m) => (
                  <li
                    key={m.name}
                    className={`rounded-md border p-2.5 ${
                      m.hasAdjacentConflict
                        ? "border-rose-700 bg-rose-950/20"
                        : m.concentrationEntries.length > 0
                          ? "border-amber-700 bg-amber-950/10"
                          : "border-slate-700 bg-slate-800/50"
                    }`}
                  >
                    <p className="text-xs font-semibold text-slate-200">
                      {m.name}
                      <span className="ml-1.5 font-normal text-slate-500">
                        （{m.entries.length}バンド）
                      </span>
                      {m.hasAdjacentConflict && (
                        <span className="ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">
                          🔴 連続出演
                        </span>
                      )}
                      {!m.hasAdjacentConflict && m.concentrationEntries.length > 0 && (
                        <span className="ml-1.5 rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                          🟡{" "}
                          {m.concentrationEntries.some((c) => c.level === "full")
                            ? "出番集中（完全）"
                            : "出番集中（部分）"}
                        </span>
                      )}
                    </p>

                    {m.hasAdjacentConflict && (
                      <p className="mt-1 text-[11px] font-medium text-rose-400">
                        ⚠️ {m.name}{" "}
                        {m.conflictReason === "same-band"
                          ? "が同じバンドで連続出演しています"
                          : "が連続しています"}
                      </p>
                    )}
                    {m.concentrationEntries.map((c) => (
                      <p
                        key={`${c.dayId}-concentration`}
                        className="mt-1 text-[11px] font-medium text-amber-400"
                      >
                        ⚠️ {!isSingleDay && `${c.dayLabel} `}
                        {formatConcentrationMessage(
                          c.totalSlots,
                          c.maxBlockSlots,
                          c.level,
                          c.blockTimeRange,
                        )}
                      </p>
                    ))}

                    {m.blocks.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {m.blocks.map((b) => (
                          <span
                            key={`${b.dayId}-${b.block}`}
                            className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] font-medium text-slate-300"
                          >
                            {!isSingleDay && `${b.dayLabel} `}
                            {b.timeRange
                              ? `${b.timeRange.start}〜${b.timeRange.end}`
                              : `ブロック${b.block + 1}`}
                            : {b.count}枠
                          </span>
                        ))}
                      </div>
                    )}

                    <ul className="mt-1.5 space-y-0.5 text-[11px] text-slate-400">
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
    </ModalPortal>
  );
}
