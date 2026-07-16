import { useRef } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { Band } from "../types";
import { useAppStore } from "../store/useAppStore";

type Props = {
  band: Band;
  onHoverStart: (band: Band, el: HTMLElement) => void;
  onHoverEnd: () => void;
};

// Compact draggable tile for the unplaced-band grid. Full details render in
// a single shared flyout owned by BandListPanel (see there for why) — this
// component only reports hover in/out plus its own DOM node.
export function BandChip({ band, onHoverStart, onHoverEnd }: Props) {
  const deleteBand = useAppStore((s) => s.deleteBand);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `band:${band.id}`,
    data: { type: "band", band },
  });
  const elRef = useRef<HTMLDivElement | null>(null);

  // No transform/translate here — the DragOverlay (a portal to
  // document.body, see App.tsx) is what visually follows the cursor. This
  // element just dims in place while dragging; applying a manual transform
  // here would also get clipped as soon as it crosses this panel's
  // overflow-y-auto boundary, which is the "chip disappears mid-drag" bug
  // the overlay is meant to fix.
  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        elRef.current = el;
      }}
      {...listeners}
      {...attributes}
      onMouseEnter={() => elRef.current && onHoverStart(band, elRef.current)}
      onMouseLeave={onHoverEnd}
      className={`flex cursor-grab items-center gap-1 rounded border px-1.5 py-1 text-xs active:cursor-grabbing ${
        isDragging ? "relative z-50 opacity-50" : ""
      } ${
        band.parseWarning
          ? "border-amber-600 bg-amber-950/40"
          : "border-slate-700 bg-slate-800 hover:border-indigo-400"
      }`}
    >
      <span className="min-w-0 flex-1 truncate font-medium text-slate-100">
        {band.name}
      </span>
      {band.hasSync && <span title="同期演奏あり">🔌</span>}
      {band.hasKeyboard && <span title="キーボードあり">🎹</span>}
      {band.setlist.length > 0 && (
        <span title={`セットリスト:\n${band.setlist.join("\n")}`}>🎵</span>
      )}
      {band.parseWarning && <span title={band.parseWarning}>⚠️</span>}
      <button
        // Stop the pointerdown from bubbling to the chip's drag listeners
        // above, otherwise clicking delete would also kick off a drag.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => deleteBand(band.id)}
        className="-my-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-base leading-none text-slate-500 hover:bg-rose-950/60 hover:text-rose-400 active:bg-rose-900/70"
        title="削除"
      >
        ×
      </button>
    </div>
  );
}
