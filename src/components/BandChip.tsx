import { useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { Band } from "../types";
import { BandDetailsForm } from "./BandDetailsForm";

type Props = { band: Band };

// Compact draggable tile for the unplaced-band grid. Full details (members,
// desired schedule, sync/keyboard toggles, ...) live in a hover popover so
// the base tile stays tiny and many bands fit on screen without scrolling.
export function BandChip({ band }: Props) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: `band:${band.id}` });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  function cancelClose() {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }
  function scheduleClose() {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 150);
  }

  return (
    <div
      className="relative"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        style={style}
        className={`flex cursor-grab items-center gap-1 rounded border px-1.5 py-1 text-xs active:cursor-grabbing ${
          isDragging ? "relative z-50 opacity-50" : ""
        } ${
          band.parseWarning
            ? "border-amber-400 bg-amber-50"
            : "border-slate-200 bg-white hover:border-indigo-300"
        }`}
        title="ドラッグしてタイムテーブルに配置／ホバーで詳細"
      >
        <span className="min-w-0 flex-1 truncate font-medium text-slate-800">
          {band.name}
        </span>
        {band.hasSync && <span title="同期演奏あり">🔌</span>}
        {band.hasKeyboard && <span title="キーボードあり">🎹</span>}
        {band.parseWarning && <span title={band.parseWarning}>⚠️</span>}
      </div>

      {open && (
        <div
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
        >
          <BandDetailsForm band={band} />
        </div>
      )}
    </div>
  );
}
