import type { Band } from "../types";

// Rendered inside <DragOverlay>, which portals to document.body — this is
// what actually follows the cursor smoothly, escaping any overflow:auto
// ancestor that would otherwise clip a plain transformed element (the
// band grid and slot list both scroll internally).
export function BandDragPreview({ band }: { band: Band }) {
  return (
    <div className="flex scale-105 cursor-grabbing items-center gap-1 rounded-lg border border-blue-400 bg-slate-800/95 px-2 py-1.5 text-xs opacity-95 shadow-2xl shadow-blue-950/70 ring-2 ring-blue-400/25">
      <span className="min-w-0 max-w-40 truncate font-medium text-slate-100">
        {band.name}
      </span>
      {band.hasSync && <span>🔌</span>}
      {band.hasKeyboard && <span>🎹</span>}
    </div>
  );
}
