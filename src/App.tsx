import { Suspense, lazy, useEffect, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { useAppStore } from "./store/useAppStore";
import { useUiStore } from "./store/useUiStore";
import { useHistoryStore } from "./store/useHistoryStore";
import { useCollabStore } from "./store/useCollabStore";
import { useIsMobile } from "./hooks/useViewport";
import { BandListPanel } from "./components/BandListPanel";
import { Timetable } from "./components/Timetable";
import { DeleteUndoToast } from "./components/DeleteUndoToast";
import { Toast } from "./components/Toast";
import { BandDragPreview } from "./components/BandDragPreview";
import { SlotDragPreview } from "./components/SlotDragPreview";
import { ApplicationManagerTab } from "./components/applications/ApplicationManagerTab";
import { BackupControls } from "./components/BackupControls";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { Band, TimetableSlot } from "./types";

// CollabRoot pulls in the firebase SDK (~150kB gzipped) — same reasoning
// as the jsPDF/exceljs/html2canvas dynamic imports elsewhere in this
// app: a heavy dependency only some visitors ever touch stays out of the
// main bundle. Gated on the raw env var (not firebase.ts's
// isFirebaseConfigured, which would itself require importing the SDK to
// check) so a deploy with no Firebase project configured — the default,
// and every visitor today — never fetches this chunk at all.
const CollabRoot = lazy(() =>
  import("./components/CollabRoot").then((m) => ({ default: m.CollabRoot })),
);
const hasFirebaseConfig = Boolean(import.meta.env.VITE_FIREBASE_PROJECT_ID);

type ActiveDragData =
  | { type: "band"; band: Band }
  | { type: "slot"; slot: TimetableSlot; band: Band | undefined };

function App() {
  const activeTab = useUiStore((s) => s.activeTab);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const days = useAppStore((s) => s.days) ?? [];
  const assignBandToSlot = useAppStore((s) => s.assignBandToSlot);
  const insertBandAtSlot = useAppStore((s) => s.insertBandAtSlot);
  const unassignSlot = useAppStore((s) => s.unassignSlot);
  const reorderSlots = useAppStore((s) => s.reorderSlots);
  const eventInfo = useAppStore((s) => s.eventInfo);
  const updateEventInfo = useAppStore((s) => s.updateEventInfo);
  const [activeDragData, setActiveDragData] = useState<ActiveDragData | null>(
    null,
  );

  // Mouse and touch get different activation rules on purpose: a mouse
  // drag on desktop should start the instant the cursor moves past a
  // tiny distance (unchanged from before), but the same instant-start
  // behavior on a touchscreen makes every attempt to scroll a slot list
  // by touching a band card start a drag instead — see SlotCard.tsx/
  // BandChip.tsx, which used to compensate with `touch-action: none` on
  // every draggable node (blocking ALL scrolling that starts on them,
  // not just accidental drags). A delay-based constraint fixes this at
  // the source: dnd-kit's TouchSensor only calls preventDefault() once
  // the touch has been held past `delay` without moving more than
  // `tolerance` (see AbstractPointerSensor.handleMove in
  // @dnd-kit/core) — a normal swipe-to-scroll exceeds tolerance well
  // before 500ms and is silently handed back to the browser, while a
  // held long-press activates the drag. That's what let touch-action:
  // none come off those nodes.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 500, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  // dnd-kit's default auto-scroll triggers within the outer 20% of the
  // scroll container's height (`threshold.y: 0.2`) and accelerates at a
  // rate tuned for a desktop-sized viewport (`acceleration: 10`, see
  // useAutoScroller's defaults in @dnd-kit/core). On a phone-height
  // screen, 20% is a big enough band that a long-press-drag anywhere in
  // the lower third of the screen — nowhere near the actual bottom edge
  // — could already start auto-scrolling, and at the default
  // acceleration it moved fast enough to overshoot past the slot the
  // user meant to drop on. `#root` is this app's real mobile scroll
  // container (see index.css / the scroll-lock round's finding), which
  // dnd-kit auto-detects as a scrollable ancestor via computed
  // `overflow-y`, so no separate wiring is needed beyond this config.
  // Desktop keeps dnd-kit's own defaults (`autoScroll={true}`) — DayPanel's
  // fixed-height, internally-scrolling panels are a different shape of
  // problem this narrower mobile threshold isn't meant to solve, and
  // nothing here suggested desktop's existing behavior was an issue.
  const isMobile = useIsMobile();
  const autoScroll = isMobile
    ? { threshold: { x: 0.2, y: 0.08 }, acceleration: 2 }
    : true;

  // ⌘Z / Ctrl+Z and ⌘⇧Z / Ctrl+Y (redo) for the Timetable Editor's
  // placement history — skipped while focus is in a text input/textarea/
  // contentEditable so it doesn't fight the browser's own native undo
  // there (e.g. band-name or venue text fields).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isModifierPressed = e.metaKey || e.ctrlKey;
      if (!isModifierPressed || e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement | null;
      const isTextEntry =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (isTextEntry) return;
      e.preventDefault();
      if (e.shiftKey) {
        useHistoryStore.getState().redo();
      } else {
        useHistoryStore.getState().undo();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleDragStart = (event: DragStartEvent) => {
    const data = (event.active.data.current as ActiveDragData) ?? null;
    setActiveDragData(data);
    // Fires exactly when a sensor activates a drag — for TouchSensor
    // that's the moment the long-press delay elapses, so this doubles as
    // the "you can now drag this" cue the touch activation constraint
    // above needs: a short vibration where supported (Android Chrome;
    // iOS Safari has no Vibration API, so this silently no-ops there —
    // feature-detected, not browser-sniffed) and, since DragOverlay
    // already shows a floating copy of whatever's being dragged, the
    // ORIGINAL card's own isDragging-driven scale-up (see SlotCard.tsx/
    // BandChip.tsx) is the other half of that same cue for devices
    // without vibration.
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(50);
    }
    // Broadcast to other collaborators (see useCollabStore/useLivePresence)
    // only for an actual band drag — a slot reorder doesn't move a band
    // identity anywhere another user would need to see "locked". No-op
    // (writes to a local store nobody reads) when not in a collab room.
    if (data?.type === "band") {
      useCollabStore.getState().setMyDragState({ isDragging: true, draggedBandId: data.band.id });
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragData(null);
    useCollabStore.getState().setMyDragState({ isDragging: false, draggedBandId: null });
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
        return;
      }

      // A band that's already placed somewhere brings its own slot along
      // for the ride — dragging its full cell is conceptually the exact
      // same move as dragging that slot's own ⠿ handle, so it goes
      // through the identical reorderSlots/arrayMove call the handle
      // uses, not insertBandAtSlot/assignBandToSlot. Those two null out
      // the origin slot's bandId in place rather than removing it, which
      // is correct for an UNPLACED band (there's no slot to relocate —
      // BandListPanel drags always take this path) but left a genuine
      // empty, un-deleted slot behind for an already-placed one, and
      // produced a different resulting order than the handle would for
      // the same drag (confirmed by reproducing both side by side: the
      // handle cleanly reordered 3 slots to 3 slots, the full-cell drag
      // left 4). reorderSlots is a pure permutation of existing slot
      // objects — nothing created, nothing orphaned — so this fixes both
      // at once, for both desktop's full-cell drag and mobile's
      // long-press (same handleDragEnd, same DndContext, already shared).
      const originDay = days.find((d) => d.slots.some((s) => s.bandId === bandId));
      const originSlot = originDay?.slots.find((s) => s.bandId === bandId);
      const targetDay = days.find((d) => d.slots.some((s) => s.id === overId));
      if (originSlot && targetDay && originDay?.id === targetDay.id) {
        if (originSlot.id !== overId) {
          reorderSlots(originSlot.id, overId);
        }
        return;
      }

      // Unplaced band, or a cross-day move (each day owns a physically
      // separate slots array with its own computed time schedule, so
      // there's no single array to permute across that boundary) —
      // unchanged "magnetic" insert/assign behavior.
      const overSlot = days.flatMap((d) => d.slots).find((s) => s.id === overId);
      if (overSlot?.bandId && overSlot.bandId !== bandId) {
        insertBandAtSlot(bandId, overId);
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
      sensors={sensors}
      autoScroll={autoScroll}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveDragData(null);
        useCollabStore.getState().setMyDragState({ isDragging: false, draggedBandId: null });
      }}
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
          {hasFirebaseConfig && (
            // Local boundary so a collaboration-feature crash (Firebase
            // misconfiguration, a bad room doc, etc.) only disables that
            // one widget — the timetable editor underneath keeps working
            // fully offline/local, exactly as if this whole feature
            // didn't exist. See project memory for the incident (an
            // uncaught RTDB init error with no boundary at all) this is
            // specifically here to contain.
            <ErrorBoundary title="共同編集機能" inline>
              <Suspense fallback={null}>
                <CollabRoot />
              </Suspense>
            </ErrorBoundary>
          )}
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
