import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  computeGearConflictDetails,
  computeMemberSchedules,
  useAppStore,
} from "../store/useAppStore";
import type { Band } from "../types";
import { useApplicationStore } from "../store/useApplicationStore";
import { useHistoryStore } from "../store/useHistoryStore";
import { useFuriganaStore } from "../store/useFuriganaStore";
import { computeMemberRoster, downloadMemberRosterExcel } from "../utils/rosterExport";
import { DayPanel } from "./DayPanel";
import { ScheduleReviewModal } from "./ScheduleReviewModal";
import { HistoryPanel } from "./HistoryPanel";
import { FuriganaImportModal } from "./FuriganaImportModal";
import type { TimetableDay } from "../types";

// Stable (never-reallocated) fallbacks for the ?? below — an inline `?? []`
// would hand useMemo/useEffect a fresh array reference on every render
// where the store value is unexpectedly falsy, defeating their dependency
// comparisons (and tripping the exhaustive-deps lint rule, which is what
// flagged this). Only matters in the edge case this whole defense exists
// for in the first place — see applyRoomDocToStore in useCollabRoom.ts.
const EMPTY_BANDS: Band[] = [];
const EMPTY_DAYS: TimetableDay[] = [];

// The desktop timetable editor: all days side by side (not tab-switched)
// so the whole event's schedule is visible on one screen at once, full
// drag-and-drop reordering via DayPanel/SlotCard, and every admin tool
// (roster export, history, furigana import, etc.) in one dense toolbar.
// Rendered by Timetable.tsx above the md: breakpoint — see
// MobileTimetable.tsx for the touch-first vertical-list equivalent below
// it. Both read the exact same useAppStore/useApplicationStore state, so
// there's nothing here that owns data the mobile view doesn't also see.
export function DesktopTimetable() {
  // ?? [] defends against days ever being undefined/null at runtime — the
  // store's own type says TimetableDay[], but data arriving from outside
  // normal store actions (a Firestore room doc via useCollabRoom) isn't
  // guaranteed to match that type, only trusted to. See
  // applyRoomDocToStore in useCollabRoom.ts for the write-side half of
  // this same defense.
  const days = useAppStore((s) => s.days) ?? EMPTY_DAYS;
  const addDay = useAppStore((s) => s.addDay);
  const autoScheduleAllDays = useAppStore((s) => s.autoScheduleAllDays);
  const resetAllPlacements = useAppStore((s) => s.resetAllPlacements);
  const clearAllSlots = useAppStore((s) => s.clearAllSlots);
  const autoDetectDayRestrictions = useAppStore(
    (s) => s.autoDetectDayRestrictions,
  );
  const bands = useAppStore((s) => s.bands) ?? EMPTY_BANDS;
  const eventInfo = useAppStore((s) => s.eventInfo);
  const applications = useApplicationStore((s) => s.applications);
  const furiganaByKey = useFuriganaStore((s) => s.furiganaByKey);
  const [showScheduleReview, setShowScheduleReview] = useState(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [showFuriganaImport, setShowFuriganaImport] = useState(false);
  const [exportingRoster, setExportingRoster] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // -1 means "query changed, haven't jumped to a match yet" — the first
  // Enter/Next press should land on match 0, not match 1, so jumpToMatch
  // always operates on matchIndex + 1 for "next."
  const [matchIndex, setMatchIndex] = useState(-1);
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

  // Only bands actually placed on the grid are searchable — an unplaced
  // band has no rendered SlotCard (and thus no #band-slot-<id> element) for
  // scrollIntoView to target, so it can't usefully be a search result here.
  // Order follows day order then slot order, giving Next/Prev a stable,
  // predictable sequence to step through.
  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const bandMap = new Map(bands.map((b) => [b.id, b]));
    const seen = new Set<string>();
    const matches: Band[] = [];
    for (const day of days) {
      for (const slot of day.slots) {
        if (!slot.bandId || seen.has(slot.bandId)) continue;
        const band = bandMap.get(slot.bandId);
        if (!band) continue;
        const nameMatch = band.name.toLowerCase().includes(q);
        const memberMatch = band.members.some((m) => m.toLowerCase().includes(q));
        if (nameMatch || memberMatch) {
          seen.add(slot.bandId);
          matches.push(band);
        }
      }
    }
    return matches;
  }, [days, bands, searchQuery]);

  // A fresh query always restarts navigation from "before the first
  // match" — see the matchIndex comment above.
  useEffect(() => {
    setMatchIndex(-1);
  }, [searchQuery]);

  function scrollToBand(bandId: string) {
    const el = document.getElementById(`band-slot-${bandId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // Temporary ring pulse so the found card is unmistakable even though
    // it's already centered — self-removing, no persisted state needed.
    const highlightClasses = [
      "ring-4",
      "ring-amber-400",
      "ring-offset-2",
      "ring-offset-slate-900",
      "animate-pulse",
    ];
    el.classList.add(...highlightClasses);
    window.setTimeout(() => el.classList.remove(...highlightClasses), 1600);
  }

  function jumpToMatch(rawIndex: number) {
    if (searchMatches.length === 0) return;
    const wrapped =
      ((rawIndex % searchMatches.length) + searchMatches.length) % searchMatches.length;
    setMatchIndex(wrapped);
    scrollToBand(searchMatches[wrapped].id);
  }

  const handleSearchNext = () => jumpToMatch(matchIndex + 1);
  const handleSearchPrev = () => jumpToMatch(matchIndex - 1);

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    handleSearchNext();
  }

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
      const entries = computeMemberRoster(days, bands, applications, furiganaByKey);
      const eventLabel = eventInfo.liveName.trim() || "ライブ";
      await downloadMemberRosterExcel(entries, `参加者名簿-${eventLabel}.xlsx`);
    } finally {
      setExportingRoster(false);
    }
  };

  console.log("Current Timetable State:", { days, bandsCount: bands.length });

  return (
    <div className="flex flex-1 flex-col gap-2 md:min-h-0">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-sm">
        <span className="text-slate-500" aria-hidden="true">
          🔍
        </span>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder="バンド名・メンバー名で検索"
          aria-label="バンド名・メンバー名で検索"
          className="min-h-11 w-48 rounded border border-slate-600 bg-slate-800 px-2.5 text-slate-100 outline-none placeholder:text-slate-500 focus:border-indigo-500 md:min-h-0 md:w-56 md:py-1.5"
        />
        <button
          type="button"
          onClick={handleSearchPrev}
          disabled={searchMatches.length === 0}
          title="前の一致へ"
          aria-label="前の一致へ"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-30 md:h-7 md:w-7"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={handleSearchNext}
          disabled={searchMatches.length === 0}
          title="次の一致へ（Enter）"
          aria-label="次の一致へ"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-30 md:h-7 md:w-7"
        >
          ›
        </button>
        {searchQuery.trim() && (
          <span className="text-xs text-slate-400">
            {searchMatches.length > 0
              ? `${matchIndex + 1 > 0 ? matchIndex + 1 : 0}/${searchMatches.length}件`
              : "見つかりません"}
          </span>
        )}
      </div>
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
          title="配置済みの全メンバーを学年・ふりがな・氏名・パートで重複なくまとめ、受付・振り込み確認のチェック欄（ドロップダウン）付きのExcel名簿を出力します"
        >
          {exportingRoster ? "名簿を生成中…" : "📇 参加者名簿を出力 (Excel)"}
        </button>
        <button
          onClick={() => setShowFuriganaImport(true)}
          className="min-h-11 rounded border border-slate-600 px-3 text-xs text-slate-300 hover:bg-slate-800 md:min-h-0 md:py-1.5"
          title="名簿マスタから氏名・ふりがなだけを安全に取り込み、参加者名簿Excelのふりがな列に反映します"
        >
          📥 ふりがな取込
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
      {days.length === 0 ? (
        // Reachable via a Firestore room doc with an empty days array
        // (e.g. a brand-new collaboration room, or every day having been
        // removed some other way that bypassed removeDay's own "can't
        // remove the last day" guard) — without this, the whole content
        // area below the toolbar would render nothing at all, which reads
        // as "the app is broken" rather than "there's nothing here yet."
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-700 p-8 text-center">
          <p className="text-sm text-slate-400">タイムテーブルがありません</p>
          <button
            onClick={addDay}
            className="min-h-11 rounded bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 md:min-h-0 md:py-1.5"
          >
            + 日を追加
          </button>
        </div>
      ) : (
        <div
          className="grid flex-1 grid-cols-1 gap-2 md:min-h-0 md:[grid-template-columns:repeat(var(--day-count),minmax(0,1fr))]"
          style={{ "--day-count": days.length } as CSSProperties}
        >
          {days.map((day) => (
            <DayPanel key={day.id} day={day} daysCount={days.length} />
          ))}
        </div>
      )}

      {showScheduleReview && (
        <ScheduleReviewModal onClose={() => setShowScheduleReview(false)} />
      )}
      {showHistoryPanel && <HistoryPanel onClose={() => setShowHistoryPanel(false)} />}
      {showFuriganaImport && (
        <FuriganaImportModal onClose={() => setShowFuriganaImport(false)} />
      )}
    </div>
  );
}
