import { useState } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { useAppStore } from "./store/useAppStore";
import { TextImportPanel } from "./components/TextImportPanel";
import { BandListPanel } from "./components/BandListPanel";
import { Timetable } from "./components/Timetable";
import { DeleteUndoToast } from "./components/DeleteUndoToast";
import { BandDragPreview } from "./components/BandDragPreview";
import { SlotDragPreview } from "./components/SlotDragPreview";
import type { Band, TimetableSlot } from "./types";

type ActiveDragData =
  | { type: "band"; band: Band }
  | { type: "slot"; slot: TimetableSlot; band: Band | undefined };

function App() {
  const days = useAppStore((s) => s.days);
  const assignBandToSlot = useAppStore((s) => s.assignBandToSlot);
  const unassignSlot = useAppStore((s) => s.unassignSlot);
  const reorderSlots = useAppStore((s) => s.reorderSlots);
  const eventInfo = useAppStore((s) => s.eventInfo);
  const updateEventInfo = useAppStore((s) => s.updateEventInfo);
  const [activeDragData, setActiveDragData] = useState<ActiveDragData | null>(
    null,
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragData((event.active.data.current as ActiveDragData) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragData(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = active.id.toString();
    const overId = over.id.toString();

    if (activeId.startsWith("band:")) {
      const bandId = activeId.replace("band:", "");
      if (overId === "unplaced") {
        const slot = days
          .flatMap((d) => d.slots)
          .find((s) => s.bandId === bandId);
        if (slot) unassignSlot(slot.id);
      } else {
        assignBandToSlot(bandId, overId);
      }
      return;
    }

    // Otherwise the drag is a slot reorder: activeId/overId are bare slot ids.
    if (activeId !== overId) {
      reorderSlots(activeId, overId);
    }
  };

  return (
    <DndContext
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveDragData(null)}
    >
      <div className="flex h-screen flex-col overflow-hidden bg-slate-950">
        <header className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-slate-800 bg-slate-900 px-6 py-2.5">
          <h1 className="shrink-0 text-lg font-bold text-slate-100">
            軽音ライブ タイムテーブル作成
          </h1>
          {/* Event-wide details (not per-day) — shown on the share image's
              header (live name/venue) and footer (organization name). */}
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <input
              value={eventInfo.liveName}
              onChange={(e) => updateEventInfo({ liveName: e.target.value })}
              placeholder="ライブ名（例：軽音祭 vol.5）"
              aria-label="ライブ名"
              className="w-48 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-indigo-500"
            />
            <input
              value={eventInfo.venue}
              onChange={(e) => updateEventInfo({ venue: e.target.value })}
              placeholder="会場"
              aria-label="会場名"
              className="w-36 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-indigo-500"
            />
            <input
              value={eventInfo.organizationName}
              onChange={(e) => updateEventInfo({ organizationName: e.target.value })}
              placeholder="団体名"
              aria-label="団体名"
              className="w-36 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-indigo-500"
            />
          </div>
        </header>
        <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[340px_1fr]">
          <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
            <TextImportPanel />
            <BandListPanel />
          </div>
          <div className="flex min-h-0 flex-col overflow-hidden">
            <Timetable />
          </div>
        </main>
        <DeleteUndoToast />
      </div>
      <DragOverlay>
        {activeDragData?.type === "band" && (
          <BandDragPreview band={activeDragData.band} />
        )}
        {activeDragData?.type === "slot" && (
          <SlotDragPreview
            slot={activeDragData.slot}
            band={activeDragData.band}
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}

export default App;
