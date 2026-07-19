import { useMemo, useState } from "react";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  computeGearConflictDetails,
  computeMemberSchedules,
  getConcentrationWarningDetails,
  getGearConflictSlotIds,
  getMemberConflictDetails,
  useAppStore,
} from "../store/useAppStore";
import { useApplicationStore } from "../store/useApplicationStore";
import { useFuriganaStore } from "../store/useFuriganaStore";
import { useHistoryStore } from "../store/useHistoryStore";
import { computeMemberRoster, downloadMemberRosterExcel } from "../utils/rosterExport";
import { MobileSlotCard } from "./MobileSlotCard";
import { SharePreviewModal } from "./SharePreviewModal";
import { ScheduleReviewModal } from "./ScheduleReviewModal";
import { HistoryPanel } from "./HistoryPanel";
import { FuriganaImportModal } from "./FuriganaImportModal";
import type { Band, TimetableDay } from "../types";

const EMPTY_BANDS: Band[] = [];
const EMPTY_DAYS: TimetableDay[] = [];

// One day, collapsed to a header + a flat vertical list — no side-by-side
// columns, no per-day settings/bulk-add/preset toolbar (those stay
// desktop-only editing tools; see DesktopTimetable/DayPanel). Each slot
// renders via MobileSlotCard — a genuinely condensed row (one line,
// strict truncation, member/setlist detail behind a 詳細 button) rather
// than SlotCard's fuller desktop layout, since a phone-width column has
// no room for SlotCard's multi-line member/conflict text without forcing
// horizontal scroll. It still shares SlotCard's exact drag wiring
// (useSortable/useDraggable, same store actions, same conflict/lock
// selectors passed in as props) — the presentation is different, the
// underlying scheduling logic is not duplicated. Starts expanded only
// for the first day so a long multi-day event doesn't dump every slot on
// screen at once.
function MobileDaySection({ day, defaultOpen }: { day: TimetableDay; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const bands = useAppStore((s) => s.bands) ?? EMPTY_BANDS;
  const removeDay = useAppStore((s) => s.removeDay);
  const daysCount = useAppStore((s) => (s.days ?? EMPTY_DAYS).length);
  const bandMap = useMemo(() => new Map(bands.map((b) => [b.id, b])), [bands]);
  const conflictDetails = getMemberConflictDetails(day, bands);
  const gearConflicts = getGearConflictSlotIds(day, bands);
  const concentrationDetails = getConcentrationWarningDetails(day, bands);

  let order = 0;

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-slate-800 bg-slate-900/40 p-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 items-center gap-2 text-left"
      >
        <span className="text-sm font-semibold text-indigo-300">{day.label}</span>
        {day.date && <span className="text-xs text-slate-500">{day.date}</span>}
        <span className="text-xs text-slate-500">（{day.slots.length}枠）</span>
        <span className="ml-auto text-slate-500">{open ? "▲" : "▼"}</span>
        {daysCount > 1 && (
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              removeDay(day.id);
            }}
            className="flex h-9 w-9 items-center justify-center text-slate-500 hover:text-rose-400"
            title="この日を削除"
          >
            ×
          </span>
        )}
      </button>

      {open &&
        (day.slots.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-700 p-3 text-center text-xs text-slate-500">
            この日にはまだ枠がありません
          </p>
        ) : (
          <SortableContext items={day.slots.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <div className="flex w-full min-w-0 flex-col gap-1">
              {day.slots.map((slot) => {
                const band = slot.bandId ? bandMap.get(slot.bandId) : undefined;
                if (band) order++;
                return (
                  <MobileSlotCard
                    key={slot.id}
                    dayId={day.id}
                    slot={slot}
                    band={band}
                    performanceOrder={band ? order : null}
                    conflicts={conflictDetails.get(slot.id) ?? []}
                    gearConflict={gearConflicts.has(slot.id)}
                    concentrationEntries={concentrationDetails.get(slot.id) ?? []}
                  />
                );
              })}
            </div>
          </SortableContext>
        ))}
    </div>
  );
}

// Touch-first vertical-list timetable view for viewports below the app's
// md: breakpoint (see useViewport.ts / Timetable.tsx). Reads the exact
// same useAppStore/useApplicationStore/useCollabStore state as
// DesktopTimetable — nothing here fetches, computes, or syncs anything of
// its own — and reuses the same store actions and conflict/concentration
// selector functions, so there is no second copy of any scheduling logic
// to drift out of sync with the desktop view. What's genuinely different
// is presentation: one continuous scroll of collapsible day sections
// instead of side-by-side DnD columns, and the denser admin tooling
// (roster export, history, furigana import, day-restriction reset, clear
// all slots) tucked behind a single "その他のツール" disclosure instead
// of a permanently-visible toolbar — still fully available, just not
// competing for space with "find my band" and "when do I play," the two
// things most useful on a phone at the venue.
export function MobileTimetable() {
  const days = useAppStore((s) => s.days) ?? EMPTY_DAYS;
  const addDay = useAppStore((s) => s.addDay);
  const autoScheduleAllDays = useAppStore((s) => s.autoScheduleAllDays);
  const resetAllPlacements = useAppStore((s) => s.resetAllPlacements);
  const clearAllSlots = useAppStore((s) => s.clearAllSlots);
  const autoDetectDayRestrictions = useAppStore((s) => s.autoDetectDayRestrictions);
  const bands = useAppStore((s) => s.bands) ?? EMPTY_BANDS;
  const eventInfo = useAppStore((s) => s.eventInfo);
  const applications = useApplicationStore((s) => s.applications);
  const furiganaByKey = useFuriganaStore((s) => s.furiganaByKey);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);
  const pastCount = useHistoryStore((s) => s.past.length);
  const futureCount = useHistoryStore((s) => s.future.length);

  const [showScheduleReview, setShowScheduleReview] = useState(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [showFuriganaImport, setShowFuriganaImport] = useState(false);
  const [exportingRoster, setExportingRoster] = useState(false);
  const [showMoreTools, setShowMoreTools] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // Which day's SharePreviewModal is open, if any — a single day at a
  // time only, so with one day (the common case for this club's events)
  // the FAB opens straight into export; with several it opens a tiny
  // picker first (below) instead of guessing which day the user meant.
  const [exportDayId, setExportDayId] = useState<string | null>(null);
  const [showDayPicker, setShowDayPicker] = useState(false);
  const exportDay = days.find((d) => d.id === exportDayId) ?? null;

  const reviewIssueCount = useMemo(() => {
    const conflictMembers = computeMemberSchedules(bands, days).filter(
      (m) => m.hasAdjacentConflict,
    ).length;
    const gearConflicts = computeGearConflictDetails(days, bands).length;
    return conflictMembers + gearConflicts;
  }, [bands, days]);

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

  function scrollToBand(bandId: string) {
    const el = document.getElementById(`band-slot-${bandId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const highlightClasses = ["ring-4", "ring-amber-400", "ring-offset-2", "ring-offset-slate-900", "animate-pulse"];
    el.classList.add(...highlightClasses);
    window.setTimeout(() => el.classList.remove(...highlightClasses), 1600);
  }

  const handleReset = () => {
    if (window.confirm("本当に配置をリセットしますか？タイムテーブル上の全てのバンドが未配置に戻ります。")) {
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

  const handleFabClick = () => {
    if (days.length === 0) return;
    if (days.length === 1) {
      setExportDayId(days[0].id);
    } else {
      setShowDayPicker(true);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-1.5 text-sm">
        <span className="text-slate-500" aria-hidden="true">🔍</span>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="バンド名・メンバー名で検索"
          aria-label="バンド名・メンバー名で検索"
          className="min-h-11 flex-1 rounded border border-slate-600 bg-slate-800 px-2.5 text-slate-100 outline-none placeholder:text-slate-500 focus:border-indigo-500"
        />
        {searchMatches.length > 0 && (
          <button
            type="button"
            onClick={() => scrollToBand(searchMatches[0].id)}
            className="min-h-11 shrink-0 rounded border border-slate-600 px-2 text-xs text-slate-300"
          >
            {searchMatches.length}件
          </button>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 text-sm">
        <button
          onClick={autoScheduleAllDays}
          className="min-h-11 flex-1 rounded bg-emerald-600 px-3 font-medium text-white hover:bg-emerald-500"
        >
          ⚡ 一括自動配置
        </button>
        <button
          onClick={addDay}
          className="min-h-11 rounded border border-dashed border-slate-600 px-3 text-slate-400 hover:bg-slate-800"
        >
          + 日を追加
        </button>
      </div>

      {days.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-700 p-8 text-center">
          <p className="text-sm text-slate-400">タイムテーブルがありません</p>
          <button
            onClick={addDay}
            className="min-h-11 rounded bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500"
          >
            + 日を追加
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {days.map((day, i) => (
            <MobileDaySection key={day.id} day={day} defaultOpen={i === 0} />
          ))}
        </div>
      )}

      <div className="rounded-lg border border-slate-800">
        <button
          type="button"
          onClick={() => setShowMoreTools((v) => !v)}
          className="flex min-h-11 w-full items-center justify-between px-3 text-xs text-slate-400"
        >
          <span>その他のツール（PC版と同じ機能）</span>
          <span>{showMoreTools ? "▲" : "▼"}</span>
        </button>
        {showMoreTools && (
          <div className="flex flex-col gap-1.5 border-t border-slate-800 p-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={undo}
                disabled={pastCount === 0}
                className="min-h-11 flex-1 rounded border border-slate-600 px-2 text-slate-300 disabled:opacity-30"
              >
                ↩ 元に戻す
              </button>
              <button
                onClick={redo}
                disabled={futureCount === 0}
                className="min-h-11 flex-1 rounded border border-slate-600 px-2 text-slate-300 disabled:opacity-30"
              >
                ↪ やり直す
              </button>
              <button
                onClick={() => setShowHistoryPanel(true)}
                className="min-h-11 flex-1 rounded border border-slate-600 px-2 text-slate-300"
              >
                🕘 履歴
              </button>
            </div>
            <button
              onClick={() => setShowScheduleReview(true)}
              className={`min-h-11 rounded border px-3 font-medium ${
                reviewIssueCount > 0
                  ? "border-amber-500 bg-amber-950/40 text-amber-300"
                  : "border-slate-600 text-slate-300"
              }`}
            >
              📋 スケジュール確認 {reviewIssueCount > 0 && `(${reviewIssueCount})`}
            </button>
            <button
              onClick={handleExportRoster}
              disabled={exportingRoster}
              className="min-h-11 rounded border border-teal-600 bg-teal-950/30 px-3 font-medium text-teal-300 disabled:opacity-50"
            >
              {exportingRoster ? "名簿を生成中…" : "📇 参加者名簿を出力 (Excel)"}
            </button>
            <button
              onClick={() => setShowFuriganaImport(true)}
              className="min-h-11 rounded border border-slate-600 px-3 text-xs text-slate-300"
            >
              📥 ふりがな取込
            </button>
            <button
              onClick={autoDetectDayRestrictions}
              className="min-h-11 rounded border border-slate-700 px-3 text-xs text-slate-500"
            >
              日程を再判定（リセット）
            </button>
            <button
              onClick={handleReset}
              className="min-h-11 rounded border border-rose-700 px-3 text-rose-300"
            >
              配置をリセット
            </button>
            <button
              onClick={handleClearAllSlots}
              className="min-h-11 rounded border border-rose-800 bg-rose-950/30 px-3 text-rose-400"
            >
              🗑 全枠削除
            </button>
          </div>
        )}
      </div>

      {showScheduleReview && <ScheduleReviewModal onClose={() => setShowScheduleReview(false)} />}
      {showHistoryPanel && <HistoryPanel onClose={() => setShowHistoryPanel(false)} />}
      {showFuriganaImport && <FuriganaImportModal onClose={() => setShowFuriganaImport(false)} />}

      {/* Fixed bottom-right FAB, independent of page scroll — stays
          reachable no matter how far down a long multi-day list is
          scrolled, and sits above everything else in this view (z-40,
          still below the z-50 modals it opens). */}
      {days.length > 0 && (
        <button
          type="button"
          onClick={handleFabClick}
          title="タイムテーブルを画像として書き出し"
          className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-2xl text-white shadow-lg shadow-black/40 active:bg-indigo-500"
        >
          🎨
        </button>
      )}

      {showDayPicker && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
          onClick={() => setShowDayPicker(false)}
        >
          <div
            className="w-full max-w-md rounded-t-2xl border-t border-slate-700 bg-slate-900 p-3 pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-2 px-1 text-xs font-semibold text-slate-400">書き出す日を選択</p>
            <div className="flex flex-col gap-1.5">
              {days.map((d) => (
                <button
                  key={d.id}
                  onClick={() => {
                    setExportDayId(d.id);
                    setShowDayPicker(false);
                  }}
                  className="min-h-11 rounded-lg border border-slate-700 bg-slate-800 px-3 text-left text-sm text-slate-100"
                >
                  {d.label}
                  {d.date && <span className="ml-2 text-xs text-slate-500">{d.date}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {exportDay && <SharePreviewModal day={exportDay} onClose={() => setExportDayId(null)} />}
    </div>
  );
}
