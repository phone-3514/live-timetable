import { useState } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { useAppStore } from "./store/useAppStore";
import { useUiStore } from "./store/useUiStore";
import { BandListPanel } from "./components/BandListPanel";
import { Timetable } from "./components/Timetable";
import { DeleteUndoToast } from "./components/DeleteUndoToast";
import { Toast } from "./components/Toast";
import { BandDragPreview } from "./components/BandDragPreview";
import { SlotDragPreview } from "./components/SlotDragPreview";
import { ApplicationManagerTab } from "./components/applications/ApplicationManagerTab";
import { BackupControls } from "./components/BackupControls";
import type { Band, TimetableSlot } from "./types";

type ActiveDragData =
  | { type: "band"; band: Band }
  | { type: "slot"; slot: TimetableSlot; band: Band | undefined };

function App() {
  const activeTab = useUiStore((s) => s.activeTab);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
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
      <div className="flex min-h-screen flex-col bg-slate-950 md:h-screen md:overflow-hidden">
        <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-800 bg-slate-900 px-3 py-2 md:gap-x-6 md:px-6 md:py-2.5">
          <h1 className="shrink-0 text-base font-bold text-slate-100 md:text-lg">
            軽音ライブ タイムテーブル作成
          </h1>
          <nav className="flex shrink-0 gap-1" role="tablist" aria-label="表示切り替え">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "timetable"}
              onClick={() => setActiveTab("timetable")}
              className={`flex min-h-11 items-center rounded px-3 text-xs font-medium transition-colors md:min-h-0 md:py-1 ${
                activeTab === "timetable"
                  ? "bg-indigo-600 text-white"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              タイムテーブル編集
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "applications"}
              onClick={() => setActiveTab("applications")}
              className={`flex min-h-11 items-center rounded px-3 text-xs font-medium transition-colors md:min-h-0 md:py-1 ${
                activeTab === "applications"
                  ? "bg-indigo-600 text-white"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              出演申し込み管理
            </button>
          </nav>
          <BackupControls />
          {/* Event-wide details (not per-day) — shown on the share image's
              header (live name/venue) and footer (organization name). Only
              relevant to the Timetable Editor. */}
          {activeTab === "timetable" && (
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <input
                value={eventInfo.liveName}
                onChange={(e) => updateEventInfo({ liveName: e.target.value })}
                placeholder="ライブ名（例：軽音祭 vol.5）"
                aria-label="ライブ名"
                className="min-h-11 w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-indigo-500 sm:w-48 md:min-h-0"
              />
              <input
                value={eventInfo.venue}
                onChange={(e) => updateEventInfo({ venue: e.target.value })}
                placeholder="会場"
                aria-label="会場名"
                className="min-h-11 flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-indigo-500 sm:w-36 sm:flex-none md:min-h-0"
              />
              <input
                value={eventInfo.organizationName}
                onChange={(e) => updateEventInfo({ organizationName: e.target.value })}
                placeholder="団体名"
                aria-label="団体名"
                className="min-h-11 flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-indigo-500 sm:w-36 sm:flex-none md:min-h-0"
              />
            </div>
          )}
        </header>
        {activeTab === "timetable" ? (
          // content-start below lg: without it, CSS Grid's default
          // align-content:stretch splits this container's full flex-1
          // height evenly across the two stacked rows once they're in a
          // single grid-cols-1 column on mobile — harmless-looking here
          // since BandListPanel's own flex-1 just absorbs the extra height,
          // but the same pattern visibly breaks as a stray gap in
          // ApplicationManagerTab, so it's fixed the same way in both
          // places rather than relying on that coincidence.
          //
          // The sidebar column is deliberately narrow (180px, down from the
          // old 340px that also had to fit the now-removed raw-paste
          // textarea) — the timetable canvas is what users actually spend
          // their time in, so unplaced bands get just enough width for a
          // compact single-column list and everything else goes to 1fr.
          <main className="grid flex-1 content-start grid-cols-1 gap-3 p-3 md:min-h-0 md:overflow-hidden md:p-4 lg:content-normal lg:grid-cols-[180px_1fr] lg:gap-4">
            <BandListPanel />
            <div className="flex flex-col md:min-h-0 md:overflow-hidden">
              <Timetable />
            </div>
          </main>
        ) : (
          <ApplicationManagerTab />
        )}
        <DeleteUndoToast />
        <Toast />
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
