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
import { useDismissibleDetails } from "../hooks/useDismissibleDetails";
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
  const moreDetailsRef = useDismissibleDetails();
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

  return (
    <div className="flex flex-1 flex-col gap-1.5 md:min-h-0">
      <div className="relative z-20 flex shrink-0 items-center gap-1.5 overflow-visible rounded-lg border border-slate-700 bg-slate-900 px-1.5 py-1 text-sm shadow-sm">
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder="検索"
          aria-label="バンド名・メンバー名で検索"
          className="min-h-11 min-w-0 flex-1 rounded border border-slate-600 bg-slate-800 px-2.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 hover:bg-slate-700 focus:border-indigo-500 md:min-h-0 md:max-w-52 md:py-1.5"
        />
        <button
          type="button"
          onClick={handleSearchPrev}
          disabled={searchMatches.length === 0}
          title="前の一致へ"
          aria-label="前の一致へ"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded border border-slate-600 text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-30 md:h-7 md:w-7"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={handleSearchNext}
          disabled={searchMatches.length === 0}
          title="次の一致へ（Enter）"
          aria-label="次の一致へ"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded border border-slate-600 text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-30 md:h-7 md:w-7"
        >
          ›
        </button>
        {searchQuery.trim() && (
          <span className="hidden text-xs text-slate-400 xl:inline">
            {searchMatches.length > 0
              ? `${matchIndex + 1 > 0 ? matchIndex + 1 : 0}/${searchMatches.length}件`
              : "見つかりません"}
          </span>
        )}
        <div className="flex shrink-0 items-center overflow-hidden rounded border border-slate-600">
          <button
            onClick={undo}
            disabled={pastCount === 0}
            title="元に戻す（⌘Z / Ctrl+Z）"
            className="flex min-h-11 items-center gap-1 px-2.5 text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-30 md:min-h-0 md:py-1.5"
          >
            ↩ {pastCount > 0 && <span className="text-[10px]">{pastCount}</span>}
          </button>
          <button
            onClick={redo}
            disabled={futureCount === 0}
            title="やり直す（⌘⇧Z / Ctrl+Shift+Z）"
            className="flex min-h-11 items-center gap-1 border-l border-slate-600 px-2.5 text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-30 md:min-h-0 md:py-1.5"
          >
            ↪ {futureCount > 0 && <span className="text-[10px]">{futureCount}</span>}
          </button>
        </div>
        <button
          onClick={autoScheduleAllDays}
          className="min-h-11 shrink-0 rounded bg-emerald-600 px-3 font-medium text-white hover:bg-emerald-500 md:min-h-0 md:py-1.5"
          title="全ての日をまとめて考慮し、希望日程・出演可能時間・機材転換の条件を満たすように未配置のバンドを自動で割り振ります（枠数もバランスを取るため自動で増減します）"
        >
          ⚡ 一括自動配置
        </button>
        <button
          onClick={addDay}
          className="min-h-11 shrink-0 rounded border border-dashed border-slate-600 px-3 text-slate-400 hover:bg-slate-700 md:min-h-0 md:py-1.5"
        >
          + 日を追加
        </button>
        <button
          onClick={() => setShowScheduleReview(true)}
          className={`min-h-11 shrink-0 rounded border px-3 font-medium md:min-h-0 md:py-1.5 ${
            reviewIssueCount > 0
              ? "border-amber-500 bg-amber-950/40 text-amber-300 hover:bg-amber-900/50"
              : "border-slate-600 text-slate-300 hover:bg-slate-700"
          }`}
          title="掛け持ちメンバーの連続枠や、機材タグが重複する連続枠をまとめて確認します"
        >
          📋 確認
          {reviewIssueCount > 0 && (
            <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-amber-950">
              {reviewIssueCount}
            </span>
          )}
        </button>
        <details ref={moreDetailsRef} className="group relative ml-auto shrink-0">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-slate-500 bg-slate-800 px-3 text-xs font-semibold text-slate-200 shadow-sm hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 md:min-h-0 md:py-1.5" aria-label="管理と出力メニュー">
            <span aria-hidden="true">🧰</span><span>管理・出力</span><span aria-hidden="true" className="text-[9px] transition-transform group-open:rotate-180">▼</span>
          </summary>
          <div className="absolute right-0 top-full z-30 mt-1 grid w-64 gap-1.5 rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-xl">
            <button onClick={() => setShowHistoryPanel(true)} className="rounded px-3 py-2 text-left text-xs text-slate-300 hover:bg-slate-700">🕘 操作履歴</button>
            <button onClick={handleExportRoster} disabled={exportingRoster} className="rounded px-3 py-2 text-left text-xs text-teal-300 hover:bg-slate-700 disabled:opacity-50">
              {exportingRoster ? "生成中…" : "📇 参加者名簿を出力"}
            </button>
            <button onClick={() => setShowFuriganaImport(true)} className="rounded px-3 py-2 text-left text-xs text-slate-300 hover:bg-slate-700">📥 ふりがな取込</button>
            <button onClick={autoDetectDayRestrictions} className="rounded px-3 py-2 text-left text-xs text-slate-400 hover:bg-slate-700">🔄 日程制限を再判定</button>
            <div className="my-0.5 border-t border-slate-700" />
            <button onClick={handleReset} className="rounded px-3 py-2 text-left text-xs text-rose-300 hover:bg-rose-950/40">↩️ 配置をリセット</button>
            <button onClick={handleClearAllSlots} className="rounded px-3 py-2 text-left text-xs text-rose-400 hover:bg-rose-950/60">🗑 全枠削除</button>
          </div>
        </details>
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
