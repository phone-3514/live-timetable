import { useRef } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { Band } from "../types";

type Props = {
  band: Band;
  onHoverStart: (band: Band, el: HTMLElement) => void;
  onHoverEnd: () => void;
};

// Compact draggable tile for the unplaced-band grid. Full details render in
// a single shared flyout owned by BandListPanel (see there for why) — this
// component only reports hover in/out plus its own DOM node.
export function BandChip({ band, onHoverStart, onHoverEnd }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: `band:${band.id}` });
  const elRef = useRef<HTMLDivElement | null>(null);

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        elRef.current = el;
      }}
      {...listeners}
      {...attributes}
      style={style}
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
      {band.parseWarning && <span title={band.parseWarning}>⚠️</span>}
    </div>
  );
}
