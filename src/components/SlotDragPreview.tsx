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
    <div className="flex w-80 cursor-grabbing items-center gap-2 rounded-lg border border-indigo-400 bg-slate-800 p-2 shadow-lg shadow-black/50">
      <div className="w-16 shrink-0 font-mono text-xs text-slate-300">
        {slot.startTime}
      </div>
      <div className="flex-1 truncate text-sm font-semibold text-slate-100">
        {label}
      </div>
    </div>
  );
}
