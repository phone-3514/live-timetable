import type { Band, TimetableSlot } from "../types";

// Overlay clone shown while dragging a slot row to reorder it.
export function SlotDragPreview({
  slot,
  band,
}: {
  slot: TimetableSlot;
  band: Band | undefined;
}) {
  const label = slot.customLabel ?? band?.name ?? "空き枠";
  return (
    <div className="flex w-80 scale-105 cursor-grabbing items-center gap-2 rounded-xl border border-blue-400 bg-slate-800/95 p-2.5 opacity-95 shadow-2xl shadow-blue-950/70 ring-2 ring-blue-400/25">
      <div className="w-16 shrink-0 font-mono text-xs text-slate-300">
        {slot.startTime}
      </div>
      <div className="flex-1 truncate text-sm font-semibold text-slate-100">
        {label}
      </div>
    </div>
  );
}
