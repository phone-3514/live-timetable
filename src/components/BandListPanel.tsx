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
  // next one, since it renders above the grid.
  function showHover(band: Band, chipEl: HTMLElement) {
    cancelHide();
    const panelRect = containerRef.current?.getBoundingClientRect();
    if (!panelRect) return;
    const chipRect = chipEl.getBoundingClientRect();
    const left = panelRect.right + 8;
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
      className={`flex min-h-0 flex-1 flex-col rounded-lg border-2 border-dashed p-2 ${
        isOver ? "border-indigo-400 bg-indigo-950/40" : "border-slate-700"
      }`}
    >
      <h2 className="mb-1 shrink-0 text-xs font-semibold text-slate-400">
        未配置のバンド（{unplaced.length}）
      </h2>
      {bands.length === 0 && (
        <p className="text-xs text-slate-500">
          左上のテキストエリアに貼り付けて「解析してリスト化」を押してください
        </p>
      )}
      {bands.length > 0 && unplaced.length === 0 && (
        <p className="text-xs text-slate-500">全てのバンドが配置済みです</p>
      )}
      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-1 overflow-y-auto pb-1">
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
        <div
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
          style={{ top: hover.top, left: hover.left, width: POPOVER_WIDTH }}
          className="fixed z-50 rounded-lg border border-slate-700 bg-slate-800 p-3 shadow-lg shadow-black/40"
        >
          <BandDetailsForm band={hover.band} />
        </div>
      )}
    </div>
  );
}
