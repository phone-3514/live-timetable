import { useEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { getPlacedBandIds, useAppStore } from "../store/useAppStore";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { BandChip } from "./BandChip";
import { BandDetailsForm } from "./BandDetailsForm";
import type { Band } from "../types";

const POPOVER_WIDTH = 256;
const POPOVER_EST_HEIGHT = 260;

export function BandListPanel() {
  const bands = useAppStore((s) => s.bands) ?? [];
  const days = useAppStore((s) => s.days) ?? [];
  const bulkAssignToDay = useAppStore((s) => s.bulkAssignToDay);
  const deleteBands = useAppStore((s) => s.deleteBands);
  const placedIds = getPlacedBandIds(days);
  const unplaced = bands.filter((b) => !placedIds.has(b.id));

  const { setNodeRef, isOver } = useDroppable({ id: "unplaced" });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [openBand, setOpenBand] = useState<{ band: Band; top: number; left: number } | null>(
    null,
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Same always-attached, no-op-when-closed pattern as BackupControls'
  // pendingRestore listener — this panel itself is never unmounted, only
  // the popover's `openBand` state toggles.
  useEscapeKey(() => {
    if (openBand) setOpenBand(null);
  });

  // If the open band gets placed into a slot (or deleted) while its popover
  // is open, its chip disappears from the DOM — nothing would otherwise
  // close the popover, since it isn't tied to hover anymore.
  useEffect(() => {
    if (openBand && !unplaced.some((b) => b.id === openBand.band.id)) {
      setOpenBand(null);
    }
  }, [unplaced, openBand]);

  // Selected bands that get placed or deleted elsewhere (e.g. a drag while
  // some OTHER chip is also checked) should drop out of the selection
  // instead of leaving a phantom count the bulk bar can't act on.
  useEffect(() => {
    setSelectedIds((prev) => {
      const stillUnplaced = new Set(unplaced.map((b) => b.id));
      const next = new Set([...prev].filter((id) => stillUnplaced.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [unplaced]);

  function toggleSelect(bandId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(bandId)) next.delete(bandId);
      else next.add(bandId);
      return next;
    });
  }

  function handleBulkAssign(dayId: string) {
    bulkAssignToDay([...selectedIds], dayId);
    setSelectedIds(new Set());
  }

  function handleBulkDelete() {
    if (
      window.confirm(`選択した${selectedIds.size}件のバンドを削除しますか？`)
    ) {
      deleteBands([...selectedIds]);
      setSelectedIds(new Set());
    }
  }

  // The flyout is anchored outside the whole grid (not below the individual
  // chip) so it never sits on top of neighboring chips. On mobile the
  // sidebar is full-width (stacked layout, see App.tsx), so "outside the
  // panel to the right" doesn't exist — the horizontal clamp below keeps it
  // fully on-screen either way, sliding it left over the panel itself once
  // there's no room beside it.
  //
  // Click-only, not hover: a hover-opened flyout needs the cursor to travel
  // from the chip to the flyout without leaving either's hit area, which
  // real mouse movement doesn't reliably manage — clicking the same chip
  // again toggles it closed instead, same as the backdrop below.
  function toggleDetails(band: Band, chipEl: HTMLElement) {
    if (openBand?.band.id === band.id) {
      setOpenBand(null);
      return;
    }
    const panelRect = containerRef.current?.getBoundingClientRect();
    if (!panelRect) return;
    const chipRect = chipEl.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(panelRect.right + 8, window.innerWidth - POPOVER_WIDTH - 8),
    );
    const top = Math.max(
      8,
      Math.min(chipRect.top, window.innerHeight - POPOVER_EST_HEIGHT - 8),
    );
    setOpenBand({ band, top, left });
  }

  return (
    <div className="flex shrink-0 flex-col gap-1.5 lg:min-h-0 lg:flex-1">
      {selectedIds.size > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 rounded-lg border border-indigo-600 bg-indigo-950/40 p-2 text-xs">
          <span className="font-semibold text-indigo-200">
            {selectedIds.size}件選択中
          </span>
          {days.map((day) => (
            <button
              key={day.id}
              onClick={() => handleBulkAssign(day.id)}
              className="min-h-9 rounded border border-emerald-600 bg-emerald-950/40 px-2 text-emerald-300 hover:bg-emerald-900/50 md:min-h-0 md:py-1"
            >
              → {day.label}へ配置
            </button>
          ))}
          <button
            onClick={handleBulkDelete}
            className="min-h-9 rounded border border-rose-600 bg-rose-950/40 px-2 text-rose-300 hover:bg-rose-900/50 md:min-h-0 md:py-1"
          >
            🗑 削除
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="min-h-9 rounded border border-slate-600 px-2 text-slate-300 hover:bg-slate-700 md:min-h-0 md:py-1"
          >
            選択解除
          </button>
        </div>
      )}
      <div
        ref={(el) => {
          setNodeRef(el);
          containerRef.current = el;
        }}
        // Below lg this is a fixed-height horizontal strip (shrink-0, flex-row)
        // so it stays out of the timetable canvas's way on mobile instead of
        // stacking a whole vertical list above it; at lg+ it becomes the
        // narrow vertical sidebar, filling the grid column's full height.
        className={`flex shrink-0 flex-row items-center gap-2 overflow-hidden rounded-lg border-2 border-dashed p-2 lg:min-h-0 lg:flex-1 lg:shrink lg:flex-col lg:items-stretch ${
          isOver ? "border-indigo-400 bg-indigo-950/40" : "border-slate-700"
        }`}
      >
        <h2 className="shrink-0 whitespace-nowrap text-xs font-semibold text-slate-400 lg:mb-1">
          <span className="lg:hidden">未配置（{unplaced.length}）</span>
          <span className="hidden lg:inline">未配置のバンド（{unplaced.length}）</span>
        </h2>
      {bands.length === 0 && (
        <p className="shrink-0 text-xs text-slate-500 lg:shrink lg:whitespace-normal">
          「出演申し込み管理」タブで申請を承認するとここに表示されます
        </p>
      )}
      {bands.length > 0 && unplaced.length === 0 && (
        <p className="shrink-0 text-xs text-slate-500 lg:shrink lg:whitespace-normal">
          全てのバンドが配置済みです
        </p>
      )}
        {/* relative z-50: matches the popover's own z-50, and — this is the
            part that matters — beats the backdrop's z-40. Without it, the
            backdrop (declared after this list in the JSX, and so already
            painted on top by source order alone even before z-index enters
            it) intercepts a click meant for a DIFFERENT chip while a
            popover is already open: the click closes the popover instead
            of ever reaching that chip's own onClick, so switching between
            two bands took two clicks (close, then open) instead of one. */}
        <div className="relative z-50 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto lg:min-h-0 lg:flex-1 lg:flex-col lg:items-stretch lg:gap-1 lg:overflow-x-visible lg:overflow-y-auto lg:pb-1">
          {unplaced.map((band) => (
            <BandChip
              key={band.id}
              band={band}
              onOpen={toggleDetails}
              selected={selectedIds.has(band.id)}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>

        {openBand && (
          <>
            {/* Click-outside-to-close — the flyout only ever opens/closes on
                a click now (see toggleDetails), so this is every platform's
                primary way to dismiss it, not just a touch fallback. */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setOpenBand(null)}
              aria-hidden="true"
            />
            <div
              style={{ top: openBand.top, left: openBand.left, width: POPOVER_WIDTH }}
              className="fixed z-50 rounded-lg border border-slate-700 bg-slate-800 p-3 shadow-lg shadow-black/40"
            >
              <BandDetailsForm band={openBand.band} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
