import { useEffect, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { getPlacedBandIds, useAppStore } from "../store/useAppStore";
import { BandChip } from "./BandChip";
import { BandDetailsForm } from "./BandDetailsForm";
import type { Band } from "../types";

const POPOVER_WIDTH = 256;
const POPOVER_EST_HEIGHT = 260;
const CLOSE_DELAY_MS = 150;

export function BandListPanel() {
  const bands = useAppStore((s) => s.bands);
  const days = useAppStore((s) => s.days);
  const placedIds = getPlacedBandIds(days);
  const unplaced = bands.filter((b) => !placedIds.has(b.id));

  const { setNodeRef, isOver } = useDroppable({ id: "unplaced" });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<number | null>(null);
  const [hover, setHover] = useState<{ band: Band; top: number; left: number } | null>(
    null,
  );

  // If the hovered band gets placed into a slot (or deleted) while its
  // popover is open, its chip disappears from the DOM without ever firing
  // mouseleave, so the popover would otherwise be stuck open indefinitely.
  useEffect(() => {
    if (hover && !unplaced.some((b) => b.id === hover.band.id)) {
      setHover(null);
    }
  }, [unplaced, hover]);

  function cancelHide() {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }
  function scheduleHide() {
    cancelHide();
    closeTimer.current = window.setTimeout(() => setHover(null), CLOSE_DELAY_MS);
  }

  // The flyout is anchored outside the whole grid (not below the individual
  // chip) so it never sits on top of neighboring chips — a popover pinned
  // under the hovered chip would otherwise block the mouse's path to the
  // next one, since it renders above the grid. On mobile the sidebar is
  // full-width (stacked layout, see App.tsx), so "outside the panel to the
  // right" doesn't exist — the horizontal clamp below keeps it fully
  // on-screen either way, sliding it left over the panel itself once
  // there's no room beside it.
  function showHover(band: Band, chipEl: HTMLElement) {
    cancelHide();
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
    setHover({ band, top, left });
  }

  return (
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
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto lg:min-h-0 lg:flex-1 lg:flex-col lg:items-stretch lg:gap-1 lg:overflow-x-visible lg:overflow-y-auto lg:pb-1">
        {unplaced.map((band) => (
          <BandChip
            key={band.id}
            band={band}
            onHoverStart={showHover}
            onHoverEnd={scheduleHide}
          />
        ))}
      </div>

      {hover && (
        <>
          {/* Touch has no hover/mouseleave to trigger scheduleHide, so a
              tap-opened flyout would otherwise be stuck open until another
              chip is tapped — this invisible backdrop gives touch users an
              explicit "tap anywhere else to close". Harmless on desktop:
              the popover's own onMouseEnter still cancels it immediately if
              the mouse happens to be over it. */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setHover(null)}
            aria-hidden="true"
          />
          <div
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
            style={{ top: hover.top, left: hover.left, width: POPOVER_WIDTH }}
            className="fixed z-50 rounded-lg border border-slate-700 bg-slate-800 p-3 shadow-lg shadow-black/40"
          >
            <BandDetailsForm band={hover.band} />
          </div>
        </>
      )}
    </div>
  );
}
