import { useRef } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { Band } from "../types";
import { useAppStore } from "../store/useAppStore";

type Props = {
  band: Band;
  onHoverStart: (band: Band, el: HTMLElement) => void;
  onHoverEnd: () => void;
  selected: boolean;
  onToggleSelect: (bandId: string) => void;
};

// Compact draggable tile for the unplaced-band grid. Full details render in
// a single shared flyout owned by BandListPanel (see there for why) — this
// component only reports hover in/out plus its own DOM node.
export function BandChip({ band, onHoverStart, onHoverEnd, selected, onToggleSelect }: Props) {
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
      // Touch has no hover, so the details flyout (which onHoverStart opens)
      // would otherwise be unreachable on mobile — a tap fires this too.
      // No touch-action: none here — App.tsx's TouchSensor uses a
      // delay-based (long-press) activation constraint, so a normal touch
      // that moves before the delay elapses is handed back to the browser
      // as an ordinary scroll instead of being claimed by dnd-kit; only a
      // held long-press activates the drag. See App.tsx's sensors comment.
      onClick={() => elRef.current && onHoverStart(band, elRef.current)}
      // Fixed width + shrink-0 below lg (a horizontal-scroll strip needs
      // each chip to keep its own width instead of collapsing to fit);
      // lg+ switches to a full-width row in the narrow vertical sidebar.
      // select-none/-webkit-touch-callout/-webkit-user-drag suppress iOS
      // Safari's long-press text-selection/callout on this chip's own
      // text (band name etc.) — see SlotCard.tsx's identical comment for
      // why one declaration here covers every child. touch-pan-x matches
      // this strip's actual scroll axis below lg (horizontal); lg+
      // switches to touch-pan-y once the layout itself switches to a
      // vertical sidebar list.
      className={`flex min-h-11 w-32 shrink-0 touch-pan-x select-none cursor-grab items-center gap-1 rounded border px-1.5 py-1 text-xs transition-transform active:cursor-grabbing md:min-h-0 lg:w-full lg:shrink lg:touch-pan-y [-webkit-touch-callout:none] [-webkit-user-drag:none] ${
        isDragging ? "relative z-50 scale-105 opacity-50" : ""
      } ${
        selected
          ? "border-indigo-400 bg-indigo-950/50"
          : band.parseWarning
            ? "border-amber-600 bg-amber-950/40"
            : "border-slate-700 bg-slate-800 hover:border-indigo-400"
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect(band.id)}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        title="複数選択して一括操作"
        className="h-4 w-4 shrink-0 cursor-pointer accent-indigo-500"
      />
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
        onClick={(e) => {
          e.stopPropagation();
          deleteBand(band.id);
        }}
        className="-my-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base leading-none text-slate-500 hover:bg-rose-950/60 hover:text-rose-400 active:bg-rose-900/70 md:h-6 md:w-6"
        title="削除"
      >
        ×
      </button>
    </div>
  );
}
