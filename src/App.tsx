import { DndContext } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { useAppStore } from "./store/useAppStore";
import { TextImportPanel } from "./components/TextImportPanel";
import { BandListPanel } from "./components/BandListPanel";
import { Timetable } from "./components/Timetable";
import { DeleteUndoToast } from "./components/DeleteUndoToast";

function App() {
  const days = useAppStore((s) => s.days);
  const assignBandToSlot = useAppStore((s) => s.assignBandToSlot);
  const unassignSlot = useAppStore((s) => s.unassignSlot);
  const reorderSlots = useAppStore((s) => s.reorderSlots);

  const handleDragEnd = (event: DragEndEvent) => {
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
    <DndContext onDragEnd={handleDragEnd}>
      <div className="flex h-screen flex-col overflow-hidden bg-slate-950">
        <header className="shrink-0 border-b border-slate-800 bg-slate-900 px-6 py-3">
          <h1 className="text-lg font-bold text-slate-100">
            軽音ライブ タイムテーブル作成
          </h1>
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
    </DndContext>
  );
}

export default App;
