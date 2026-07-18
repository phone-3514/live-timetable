import { create } from "zustand";

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

  setRoomState: (roomId: string | null, status: CollabStatus) => void;
  setNickname: (nickname: string | null) => void;
  setOthers: (others: PresenceEntry[]) => void;
  setMyDragState: (state: DragState) => void;
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

  setRoomState: (roomId, status) => set({ roomId, status }),
  setNickname: (myNickname) => set({ myNickname }),
  setOthers: (others) => set({ others }),
  setMyDragState: (myDragState) => set({ myDragState }),
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
