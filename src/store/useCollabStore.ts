import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

export type PresenceEntry = {
  clientId: string;
  nickname: string;
  // Fractions of the sender's own viewport (0–1), not raw pixels — a
  // desktop cursor at x=1200 on a 1920px-wide screen and a mobile viewer
  // on a 375px-wide screen don't share a coordinate space, so the only
  // portable value to broadcast is "how far across their own screen."
  // LiveCursors converts back to this VIEWER's pixels via CSS percentage
  // positioning at render time. See useLivePresence.ts's handleMouseMove.
  cursor: { xPct: number; yPct: number } | null;
  isDragging: boolean;
  draggedBandId: string | null;
  // Which slot's card this collaborator's mouse is currently over — a
  // TimetableSlot id, or null when they're not hovering any tracked card.
  // Keyed by slot id (not band id) specifically so a Rehearsal/Break
  // custom slot — which has no band at all — tracks exactly the same way
  // a band-filled slot does; every slot has an id, only some have a band.
  // Unlike `cursor` above, this is layout-independent: a raw x/y position
  // is meaningless translated onto a completely different DOM arrangement
  // (desktop's side-by-side grid vs. mobile's accordion list), but "slot
  // X's card" refers to the same thing regardless of where either
  // viewer's layout happens to draw it. That's what lets a mobile viewer
  // render "someone's looking at this" directly on the matching
  // accordion row instead of trying to reproduce a floating cursor that
  // wouldn't correspond to anything on their screen. See SlotCard.tsx's
  // onMouseEnter/onMouseLeave and useLivePresence.ts.
  hoveredElementId: string | null;
};

// Mirrors useFirestoreSync's SyncStatus exactly (same literal values) —
// redefined here rather than imported from that module, since importing
// it would pull "firebase/firestore" into this store's dependency graph
// and defeat the whole point of keeping useCollabStore Firebase-free.
export type CollabStatus = "offline" | "connecting" | "synced" | "error";

type DragState = { isDragging: boolean; draggedBandId: string | null };

type CollabState = {
  roomId: string | null;
  status: CollabStatus;
  myNickname: string | null;
  others: PresenceEntry[];
  /** This client's own current drag state — App.tsx's DndContext handlers
   * write here directly. Deliberately just data, no Firebase call: this
   * store has zero dependency on the firebase package so importing it
   * (from SlotCard, App.tsx, anywhere) never pulls the SDK into the main
   * bundle. The lazy-loaded useLivePresence hook is the only thing that
   * reads `myDragState` and actually pushes it to RTDB. */
  myDragState: DragState;
  /** This client's own currently-hovered slot id, or null. Same
   * Firebase-free write pattern as myDragState — SlotCard writes here
   * directly on mouse enter/leave (every slot, band-filled, empty, or a
   * Rehearsal/Break custom slot alike), and the lazy-loaded
   * useLivePresence hook is the only thing that reads it and pushes it
   * to RTDB. */
  myHoveredElementId: string | null;
  /** Whether THIS tab authenticated as admin (see adminAuth.ts) — read by
   * CollabControls to decide whether to render kick buttons at all, and
   * by useLivePresence to decide whether it's even worth attempting the
   * (unenforceable at the database level — see kickUser's own comment)
   * forceKick write. */
  isAdmin: boolean;
  /** Set by useLivePresence the moment it sees `forceKick: true` on THIS
   * client's own presence node. CollabRoot watches this and reacts (wipe
   * state, leave the room, clear session flags) — kept as a plain flag
   * here rather than useLivePresence acting directly, so the actual
   * "what does being kicked DO" policy lives in one place (CollabRoot)
   * instead of being embedded in the Firebase-touching hook. */
  kicked: boolean;

  setRoomState: (roomId: string | null, status: CollabStatus) => void;
  setNickname: (nickname: string | null) => void;
  setOthers: (others: PresenceEntry[]) => void;
  setMyDragState: (state: DragState) => void;
  setMyHoveredElementId: (id: string | null) => void;
  setIsAdmin: (isAdmin: boolean) => void;
  setKicked: (kicked: boolean) => void;
};

// Shared, no-Firebase-dependency slice of collaboration state — see the
// module comment on myDragState for why this split exists. Everything
// that actually talks to Firestore/RTDB lives behind the lazy-loaded
// CollabRoot component and only ever *writes into* this store; ordinary
// UI components (SlotCard, DayPanel, App) only ever *read* from it, so
// they stay in the main bundle without dragging Firebase along.
export const useCollabStore = create<CollabState>((set) => ({
  roomId: null,
  status: "offline",
  myNickname: null,
  others: [],
  myDragState: { isDragging: false, draggedBandId: null },
  myHoveredElementId: null,
  isAdmin: false,
  kicked: false,

  setRoomState: (roomId, status) => set({ roomId, status }),
  setNickname: (myNickname) => set({ myNickname }),
  setOthers: (others) => set({ others }),
  setMyDragState: (myDragState) => set({ myDragState }),
  setMyHoveredElementId: (myHoveredElementId) => set({ myHoveredElementId }),
  setIsAdmin: (isAdmin) => set({ isAdmin }),
  setKicked: (kicked) => set({ kicked }),
}));

/** Nickname of whichever OTHER collaborator is currently dragging this
 * band, or null if nobody else is. Used by SlotCard to show a locked
 * state and disable its own drag handle while someone else has it. */
export function useLockedBandOwner(bandId: string | undefined): string | null {
  return useCollabStore((s) => {
    if (!bandId) return null;
    return s.others.find((o) => o.isDragging && o.draggedBandId === bandId)?.nickname ?? null;
  });
}

/** Nicknames of every OTHER collaborator currently hovering this slot's
 * card, empty when nobody is. `elementId` is a TimetableSlot id — works
 * identically for a band-filled slot, an empty one, or a Rehearsal/Break
 * custom slot, since all three are tracked the same way (see
 * PresenceEntry.hoveredElementId for why element-id, not cursor
 * position, is what makes this meaningful on a layout completely
 * different from whichever one the hovering collaborator is using). */
export function useHoveringUsers(elementId: string | undefined): string[] {
  // useShallow so the mapped array's element-by-element equality (not
  // reference equality) decides whether this actually changed — without
  // it, a plain selector returning `.filter().map()` hands back a brand
  // new array on every store notification regardless of whether the
  // hovering set truly changed, and React 18's useSyncExternalStore
  // treats that as "the snapshot is always different," which forces an
  // infinite re-render loop the very first time two clients are in a
  // room together (hit this directly while verifying — SlotCard crashed
  // via ErrorBoundary with "Maximum update depth exceeded").
  return useCollabStore(
    useShallow((s) => {
      if (!elementId) return [];
      return s.others.filter((o) => o.hoveredElementId === elementId).map((o) => o.nickname);
    }),
  );
}
