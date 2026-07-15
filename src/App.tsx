import { DndContext } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { useAppStore } from "./store/useAppStore";
import { TextImportPanel } from "./components/TextImportPanel";
import { BandListPanel } from "./components/BandListPanel";
import { Timetable } from "./components/Timetable";

function App() {
  const slots = useAppStore((s) => s.slots);
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
        const slot = slots.find((s) => s.bandId === bandId);
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
      <div className="min-h-screen bg-slate-100">
        <header className="border-b border-slate-200 bg-white px-6 py-4">
          <h1 className="text-lg font-bold text-slate-800">
            軽音ライブ タイムテーブル作成
          </h1>
        </header>
        <main className="mx-auto grid max-w-6xl grid-cols-1 gap-6 p-6 lg:grid-cols-[380px_1fr]">
          <div className="flex flex-col gap-6">
            <TextImportPanel />
            <BandListPanel />
          </div>
          <Timetable />
        </main>
      </div>
    </DndContext>
  );
}

export default App;
