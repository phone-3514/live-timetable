import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragMoveEvent, DragStartEvent } from "@dnd-kit/core";
import { useAppStore } from "./store/useAppStore";
import { useUiStore } from "./store/useUiStore";
import { setNextHistoryAction, useHistoryStore } from "./store/useHistoryStore";
import { useCollabStore } from "./store/useCollabStore";
import { useIsMobile } from "./hooks/useViewport";
import { useAsymmetricAutoScroll } from "./hooks/useAsymmetricAutoScroll";
import { useDismissibleDetails } from "./hooks/useDismissibleDetails";
import { useSyncThemeAttribute } from "./hooks/useSyncThemeAttribute";
import { BandListPanel } from "./components/BandListPanel";
import { Timetable } from "./components/Timetable";
import { DeleteUndoToast } from "./components/DeleteUndoToast";
import { Toast } from "./components/Toast";
import { BandDragPreview } from "./components/BandDragPreview";
import { SlotDragPreview } from "./components/SlotDragPreview";
import { ApplicationManagerTab } from "./components/applications/ApplicationManagerTab";
import { BackupControls } from "./components/BackupControls";
import { ThemeToggle } from "./components/ThemeToggle";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AccessibilitySettings } from "./components/AccessibilitySettings";
import { useSyncAccessibility } from "./hooks/useSyncAccessibility";
import type { Band, TimetableSlot } from "./types";
import { MoveUndoToast } from "./components/MoveUndoToast";

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

function App({ onReturnToEntry }: { onReturnToEntry: () => void }) {
  const activeTab = useUiStore((s) => s.activeTab);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const days = useAppStore((s) => s.days) ?? [];
  const bands = useAppStore((s) => s.bands) ?? [];
  const assignBandToSlot = useAppStore((s) => s.assignBandToSlot);
  const insertBandAtSlot = useAppStore((s) => s.insertBandAtSlot);
  const unassignSlot = useAppStore((s) => s.unassignSlot);
  const reorderSlots = useAppStore((s) => s.reorderSlots);
  const eventInfo = useAppStore((s) => s.eventInfo);
  const updateEventInfo = useAppStore((s) => s.updateEventInfo);
  const [activeDragData, setActiveDragData] = useState<ActiveDragData | null>(
    null,
  );
  const [moveNotice, setMoveNotice] = useState<{ id: number; message: string } | null>(null);
  const closeMoveNotice = useCallback(() => setMoveNotice(null), []);
  const eventInfoDetailsRef = useDismissibleDetails();

  useSyncThemeAttribute();
  useSyncAccessibility();

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

  // Mobile auto-scroll follows the dragged row's viewport position: the
  // top/bottom 20% scroll at a constant speed and the centre 60% stops it
  // immediately. It deliberately ignores distance from the drag's origin,
  // which was the source of sticky scrolling after returning to the centre.
  // Desktop retains dnd-kit's behavior for its scrolling day panels.
  const isMobile = useIsMobile();
  const autoScroll = isMobile ? false : true;
  const asymmetricAutoScroll = useAsymmetricAutoScroll({
    enabled: isMobile,
    activeZoneRatio: 0.2,
    scrollStep: 4,
  });

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
    asymmetricAutoScroll.onDragStart(event);
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

  const handleDragMove = (event: DragMoveEvent) => {
    asymmetricAutoScroll.onDragMove(event);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    asymmetricAutoScroll.onDragEnd();
    setActiveDragData(null);
    useCollabStore.getState().setMyDragState({ isDragging: false, draggedBandId: null });
    const { active, over } = event;
    if (!over) return;
    const activeId = active.id.toString();
    const overId = over.id.toString();

    if (activeId.startsWith("band:")) {
      const bandId = activeId.replace("band:", "");
      const movedBand = bands.find((band) => band.id === bandId);
      const actor = useCollabStore.getState().myNickname ?? "この端末";
      const notifyMove = () => setMoveNotice({
        id: Date.now(),
        message: movedBand ? `「${movedBand.name}」を移動しました` : "バンドを移動しました",
      });
      if (overId === "unplaced") {
        const slot = days
          .flatMap((d) => d.slots)
          .find((s) => s.bandId === bandId);
        if (slot) {
          setNextHistoryAction("バンドを未配置へ移動", actor);
          unassignSlot(slot.id);
          notifyMove();
        }
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
          setNextHistoryAction("出演順を変更", actor);
          reorderSlots(originSlot.id, overId);
          notifyMove();
        }
        return;
      }

      // Unplaced band, or a cross-day move (each day owns a physically
      // separate slots array with its own computed time schedule, so
      // there's no single array to permute across that boundary) —
      // unchanged "magnetic" insert/assign behavior.
      const overSlot = days.flatMap((d) => d.slots).find((s) => s.id === overId);
      if (!overSlot) return;
      setNextHistoryAction(originSlot ? "バンドを別日へ移動" : "バンドを配置", actor);
      if (overSlot.bandId && overSlot.bandId !== bandId) {
        insertBandAtSlot(bandId, overId);
      } else {
        assignBandToSlot(bandId, overId);
      }
      notifyMove();
      return;
    }

    // Otherwise the drag is a slot reorder: activeId/overId are bare slot ids.
    if (activeId !== overId) {
      const day = days.find((candidate) => candidate.slots.some((slot) => slot.id === activeId));
      const targetIsSameDay = day?.slots.some((slot) => slot.id === overId);
      if (day && targetIsSameDay) {
        const draggedSlot = day.slots.find((slot) => slot.id === activeId);
        const draggedBand = bands.find((band) => band.id === draggedSlot?.bandId);
        const label = draggedBand?.name ?? draggedSlot?.customLabel ?? "行";
        setNextHistoryAction("出演順を変更", useCollabStore.getState().myNickname ?? "この端末");
        reorderSlots(activeId, overId);
        setMoveNotice({ id: Date.now(), message: `「${label}」を移動しました` });
      }
    }
  };

  return (
    <DndContext
      sensors={sensors}
      autoScroll={autoScroll}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        asymmetricAutoScroll.onDragCancel();
        setActiveDragData(null);
        useCollabStore.getState().setMyDragState({ isDragging: false, draggedBandId: null });
      }}
    >
      <div className="flex min-h-screen flex-col bg-slate-950 md:h-screen md:overflow-hidden">
        <header className="relative z-30 flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-700 bg-slate-900 px-3 py-2 shadow-sm md:h-12 md:flex-nowrap md:gap-1.5 md:py-1.5">
          <h1 className="shrink-0 text-sm font-bold tracking-tight text-slate-100 md:px-1 md:text-base">
            Live Timetable
            <span className="ml-2 hidden text-[10px] font-medium text-slate-500 xl:inline">
              軽音ライブ編成
            </span>
          </h1>
          <nav className="grid w-full shrink-0 grid-cols-2 gap-1 rounded-xl border border-slate-600 bg-slate-800 p-1 shadow-inner md:flex md:w-auto md:rounded-lg md:p-0.5" role="tablist" aria-label="編集画面と申込管理の切り替え" aria-orientation="horizontal">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "timetable"}
              onClick={() => setActiveTab("timetable")}
              className={`flex min-h-14 min-w-0 items-center gap-2 rounded-lg px-3 text-left transition-all md:min-h-0 md:gap-1.5 md:px-2.5 md:py-1 ${
                activeTab === "timetable"
                  ? "bg-indigo-600 text-white shadow-sm ring-1 ring-inset ring-indigo-400"
                  : "text-slate-400 hover:bg-slate-700 hover:text-slate-200"
              }`}
            >
              <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-base md:h-6 md:w-6 md:text-sm ${activeTab === "timetable" ? "bg-white/15" : "bg-slate-700"}`}>✏️</span>
              <span className="min-w-0 flex-1"><strong className="block text-sm leading-tight md:text-xs">編集</strong><span className={`block truncate text-[10px] leading-tight md:hidden ${activeTab === "timetable" ? "text-indigo-100" : "text-slate-500"}`}>タイムテーブルを作成</span></span>
              {activeTab === "timetable" && <span className="shrink-0 rounded-full bg-white/15 px-1.5 py-0.5 text-[9px] font-bold"><span aria-hidden="true">✓ </span>選択中</span>}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "applications"}
              onClick={() => setActiveTab("applications")}
              className={`flex min-h-14 min-w-0 items-center gap-2 rounded-lg px-3 text-left transition-all md:min-h-0 md:gap-1.5 md:px-2.5 md:py-1 ${
                activeTab === "applications"
                  ? "bg-indigo-600 text-white shadow-sm ring-1 ring-inset ring-indigo-400"
                  : "text-slate-400 hover:bg-slate-700 hover:text-slate-200"
              }`}
            >
              <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-base md:h-6 md:w-6 md:text-sm ${activeTab === "applications" ? "bg-white/15" : "bg-slate-700"}`}>📝</span>
              <span className="min-w-0 flex-1"><strong className="block text-sm leading-tight md:text-xs">申込管理</strong><span className={`block truncate text-[10px] leading-tight md:hidden ${activeTab === "applications" ? "text-indigo-100" : "text-slate-500"}`}>確認・承認・出演登録</span></span>
              {activeTab === "applications" && <span className="shrink-0 rounded-full bg-white/15 px-1.5 py-0.5 text-[9px] font-bold"><span aria-hidden="true">✓ </span>選択中</span>}
            </button>
          </nav>
          {activeTab === "timetable" && (
            <details ref={eventInfoDetailsRef} className="group relative w-full min-w-0 shrink-0 md:w-auto">
              <summary className="flex min-h-11 w-full cursor-pointer list-none items-center justify-between rounded px-2.5 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200 md:min-h-0 md:w-auto md:justify-start md:py-1.5">
                <span className="md:hidden xl:inline">イベント情報</span>
                <span className="hidden md:inline xl:hidden">情報</span>
                <span className="ml-1 text-[9px] transition-transform group-open:rotate-180">▼</span>
              </summary>
              <div className="mt-2 flex w-full min-w-0 flex-col gap-2 rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-xl md:absolute md:left-0 md:top-full md:mt-1 md:w-80">
                <label className="min-w-0 text-[11px] font-medium text-slate-400">
                  ライブ名
                  <input
                    value={eventInfo.liveName}
                    onChange={(e) => updateEventInfo({ liveName: e.target.value })}
                    placeholder="例：軽音祭 vol.5"
                    className="mt-1 min-h-11 w-full min-w-0 rounded border border-slate-600 bg-slate-800 px-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 hover:bg-slate-700 focus:border-indigo-500 md:min-h-0 md:py-2"
                  />
                </label>
                <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="min-w-0 text-[11px] font-medium text-slate-400">
                    会場
                    <input
                      value={eventInfo.venue}
                      onChange={(e) => updateEventInfo({ venue: e.target.value })}
                      placeholder="会場名"
                      className="mt-1 min-h-11 w-full min-w-0 rounded border border-slate-600 bg-slate-800 px-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 hover:bg-slate-700 focus:border-indigo-500 md:min-h-0 md:py-2"
                    />
                  </label>
                  <label className="min-w-0 text-[11px] font-medium text-slate-400">
                    団体名
                    <input
                      value={eventInfo.organizationName}
                      onChange={(e) => updateEventInfo({ organizationName: e.target.value })}
                      placeholder="団体名"
                      className="mt-1 min-h-11 w-full min-w-0 rounded border border-slate-600 bg-slate-800 px-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 hover:bg-slate-700 focus:border-indigo-500 md:min-h-0 md:py-2"
                    />
                  </label>
                </div>
              </div>
            </details>
          )}
          {hasFirebaseConfig && (
            <ErrorBoundary title="共同編集機能" inline>
              <Suspense fallback={null}>
                <CollabRoot />
              </Suspense>
            </ErrorBoundary>
          )}
          <div className="hidden min-w-0 flex-1 md:block" />
          <button type="button" onClick={onReturnToEntry} className="min-h-11 shrink-0 rounded border border-slate-600 px-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 md:min-h-0 md:py-1.5">↩ エントリー画面へ戻る</button>
          <BackupControls />
          <AccessibilitySettings />
          <ThemeToggle />
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
          <main className="grid flex-1 content-start grid-cols-1 gap-3 p-3 md:min-h-0 md:overflow-hidden md:p-2.5 lg:content-normal lg:grid-cols-[168px_1fr] lg:gap-3">
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
        <MoveUndoToast notice={moveNotice} onClose={closeMoveNotice} />
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
