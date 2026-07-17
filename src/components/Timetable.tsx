import { useMemo, useState, type CSSProperties } from "react";
import {
  computeGearConflictDetails,
  computeMemberSchedules,
  useAppStore,
} from "../store/useAppStore";
import { useApplicationStore } from "../store/useApplicationStore";
import { useHistoryStore } from "../store/useHistoryStore";
import { computeMemberRoster, downloadMemberRosterExcel } from "../utils/rosterExport";
import { DayPanel } from "./DayPanel";
import { ScheduleReviewModal } from "./ScheduleReviewModal";
import { HistoryPanel } from "./HistoryPanel";

// All days render side by side (not tab-switched) so the whole event's
// schedule is visible on one 100vh screen at once. Actions that used to be
// scoped to "the active day" are now either per-DayPanel (add slot,
// export) or genuinely global (auto-schedule, reset — both operate across
// every day at once).
export function Timetable() {
  const days = useAppStore((s) => s.days);
  const addDay = useAppStore((s) => s.addDay);
  const autoScheduleAllDays = useAppStore((s) => s.autoScheduleAllDays);
  const resetAllPlacements = useAppStore((s) => s.resetAllPlacements);
  const clearAllSlots = useAppStore((s) => s.clearAllSlots);
  const autoDetectDayRestrictions = useAppStore(
    (s) => s.autoDetectDayRestrictions,
  );
  const bands = useAppStore((s) => s.bands);
  const eventInfo = useAppStore((s) => s.eventInfo);
  const applications = useApplicationStore((s) => s.applications);
  const [showScheduleReview, setShowScheduleReview] = useState(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [exportingRoster, setExportingRoster] = useState(false);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);
  const pastCount = useHistoryStore((s) => s.past.length);
  const futureCount = useHistoryStore((s) => s.future.length);

  const reviewIssueCount = useMemo(() => {
    const conflictMembers = computeMemberSchedules(bands, days).filter(
      (m) => m.hasAdjacentConflict,
    ).length;
    const gearConflicts = computeGearConflictDetails(days, bands).length;
    return conflictMembers + gearConflicts;
  }, [bands, days]);

  const handleReset = () => {
    if (
      window.confirm(
        "本当に配置をリセットしますか？タイムテーブル上の全てのバンドが未配置に戻ります。",
      )
    ) {
      resetAllPlacements();
    }
  };

  const handleClearAllSlots = () => {
    if (
      window.confirm(
        "本当に全ての枠を削除しますか？タイムテーブル上の演奏枠・休憩枠などが全て削除され、空の状態に戻ります（この操作は元に戻せません）。",
      )
    ) {
      clearAllSlots();
    }
  };

  const handleExportRoster = async () => {
    setExportingRoster(true);
    try {
      const entries = computeMemberRoster(days, bands, applications);
      const eventLabel = eventInfo.liveName.trim() || "ライブ";
      await downloadMemberRosterExcel(entries, `参加者名簿-${eventLabel}.xlsx`);
    } finally {
      setExportingRoster(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-2 md:min-h-0">
      <div className="flex shrink-0 flex-wrap items-center gap-2 text-sm">
        <div className="flex shrink-0 items-center overflow-hidden rounded border border-slate-600">
          <button
            onClick={undo}
            disabled={pastCount === 0}
            title="元に戻す（⌘Z / Ctrl+Z）"
            className="flex min-h-11 items-center gap-1 px-2.5 text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-30 md:min-h-0 md:py-1.5"
          >
            ↩ {pastCount > 0 && <span className="text-[10px]">{pastCount}</span>}
          </button>
          <button
            onClick={redo}
            disabled={futureCount === 0}
            title="やり直す（⌘⇧Z / Ctrl+Shift+Z）"
            className="flex min-h-11 items-center gap-1 border-l border-slate-600 px-2.5 text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-30 md:min-h-0 md:py-1.5"
          >
            ↪ {futureCount > 0 && <span className="text-[10px]">{futureCount}</span>}
          </button>
          <button
            onClick={() => setShowHistoryPanel(true)}
            title="操作履歴から任意の時点に戻す"
            className="flex min-h-11 items-center border-l border-slate-600 px-2.5 text-slate-300 hover:bg-slate-800 md:min-h-0 md:py-1.5"
          >
            🕘
          </button>
        </div>
        <button
          onClick={autoScheduleAllDays}
          className="min-h-11 rounded bg-emerald-600 px-3 font-medium text-white hover:bg-emerald-500 md:min-h-0 md:py-1.5"
          title="全ての日をまとめて考慮し、希望日程・出演可能時間・機材転換の条件を満たすように未配置のバンドを自動で割り振ります（枠数もバランスを取るため自動で増減します）"
        >
          ⚡ 一括自動配置
        </button>
        <button
          onClick={handleReset}
          className="min-h-11 rounded border border-rose-700 px-3 text-rose-300 hover:bg-rose-950/40 md:min-h-0 md:py-1.5"
        >
          配置をリセット
        </button>
        <button
          onClick={handleClearAllSlots}
          className="min-h-11 rounded border border-rose-800 bg-rose-950/30 px-3 text-rose-400 hover:bg-rose-950/60 md:min-h-0 md:py-1.5"
          title="演奏枠・休憩枠など、全ての日の枠を完全に削除して空の状態に戻します"
        >
          🗑 全枠削除
        </button>
        <button
          onClick={addDay}
          className="min-h-11 rounded border border-dashed border-slate-600 px-3 text-slate-400 hover:bg-slate-800 md:min-h-0 md:py-1.5"
        >
          + 日を追加
        </button>
        <button
          onClick={() => setShowScheduleReview(true)}
          className={`min-h-11 rounded border px-3 font-medium md:min-h-0 md:py-1.5 ${
            reviewIssueCount > 0
              ? "border-amber-500 bg-amber-950/40 text-amber-300 hover:bg-amber-900/50"
              : "border-slate-600 text-slate-300 hover:bg-slate-800"
          }`}
          title="掛け持ちメンバーの連続枠や、機材タグが重複する連続枠をまとめて確認します"
        >
          📋 スケジュール確認
          {reviewIssueCount > 0 && (
            <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-amber-950">
              {reviewIssueCount}
            </span>
          )}
        </button>
        <button
          onClick={handleExportRoster}
          disabled={exportingRoster}
          className="min-h-11 rounded border border-teal-600 bg-teal-950/30 px-3 font-medium text-teal-300 hover:bg-teal-900/50 disabled:cursor-not-allowed disabled:opacity-50 md:min-h-0 md:py-1.5"
          title="配置済みの全メンバーを学年・氏名・パートで重複なくまとめ、受付・振り込み確認チェック欄付きのExcel名簿を出力します"
        >
          {exportingRoster ? "名簿を生成中…" : "📇 参加者名簿を出力 (Excel)"}
        </button>
        <button
          onClick={autoDetectDayRestrictions}
          className="min-h-11 rounded border border-slate-700 px-3 text-xs text-slate-500 hover:bg-slate-800 md:ml-auto md:min-h-0 md:py-1"
          title="通常は不要です（貼り付け・希望/NG時間帯の編集・日付の設定のたびに自動で判定されます）。バンドカードで手動変更した出演可能日を、希望/NG時間帯のテキストが示す内容にリセットしたいときに使います"
        >
          日程を再判定（リセット）
        </button>
      </div>

      {/* Side-by-side columns only from md up — below that, days stack
          vertically (each panel gets a bounded, independently-scrollable
          height; see DayPanel) since there's no room to show multiple full
          day columns on a phone screen. --day-count carries the desktop
          column count through so the md: grid still expands/contracts with
          the actual number of days. */}
      <div
        className="grid flex-1 grid-cols-1 gap-2 md:min-h-0 md:[grid-template-columns:repeat(var(--day-count),minmax(0,1fr))]"
        style={{ "--day-count": days.length } as CSSProperties}
      >
        {days.map((day) => (
          <DayPanel key={day.id} day={day} daysCount={days.length} />
        ))}
      </div>

      {showScheduleReview && (
        <ScheduleReviewModal onClose={() => setShowScheduleReview(false)} />
      )}
      {showHistoryPanel && <HistoryPanel onClose={() => setShowHistoryPanel(false)} />}
    </div>
  );
}
