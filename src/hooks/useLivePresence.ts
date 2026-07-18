import { useEffect, useRef } from "react";
import { onDisconnect, onValue, ref, remove, serverTimestamp, update } from "firebase/database";
import { rtdb } from "../firebase";
import { useCollabStore, type PresenceEntry } from "../store/useCollabStore";

// 50–100ms throttle on mousemove/drag broadcasts, per spec — bounds RTDB
// bandwidth and stops the cursor overlay from jittering with every
// sub-pixel pointer event, at a cadence still smooth enough to read as
// "live." A plain timestamp check (not a library) — same reasoning as
// the hand-rolled debounce in useFirestoreSync.ts, one more dependency
// isn't worth it for this.
const THROTTLE_MS = 80;

function generateClientId(): string {
  return Math.random().toString(36).slice(2, 10);
}

type RawPresenceValue = {
  nickname?: string;
  cursor?: { x: number; y: number } | null;
  isDragging?: boolean;
  draggedBandId?: string | null;
};

/**
 * Broadcasts this client's cursor position and drag state to
 * `/presence/{roomId}/{clientId}` in Realtime Database, and subscribes to
 * every OTHER client's presence in the same room — publishing the result
 * into useCollabStore (see that file for why this hook writes there
 * instead of returning the list directly: SlotCard and friends need it
 * without importing this Firebase-touching module).
 *
 * `onDisconnect().remove()` is what makes closing the tab (or losing the
 * connection) clean up automatically server-side — no client code has to
 * run for a departed collaborator's cursor to disappear for everyone else.
 *
 * No-ops entirely (never touches the network) when `roomId` or `nickname`
 * is null — matches useCollabRoom's own "not in a room yet" no-op shape.
 */
export function useLivePresence(roomId: string | null, nickname: string | null) {
  const clientIdRef = useRef<string>(generateClientId());
  const lastCursorSentRef = useRef(0);

  useEffect(() => {
    if (!roomId || !nickname || !rtdb) {
      useCollabStore.getState().setOthers([]);
      return;
    }

    const myRef = ref(rtdb, `presence/${roomId}/${clientIdRef.current}`);
    const roomRef = ref(rtdb, `presence/${roomId}`);

    update(myRef, {
      nickname,
      cursor: null,
      isDragging: false,
      draggedBandId: null,
      updatedAt: serverTimestamp(),
    });
    const disconnectHandle = onDisconnect(myRef);
    void disconnectHandle.remove();

    const unsubscribe = onValue(roomRef, (snapshot) => {
      const val = (snapshot.val() ?? {}) as Record<string, RawPresenceValue>;
      const others: PresenceEntry[] = Object.entries(val)
        .filter(([clientId]) => clientId !== clientIdRef.current)
        .map(([clientId, v]) => ({
          clientId,
          nickname: v.nickname ?? "名無し",
          cursor: v.cursor ?? null,
          isDragging: Boolean(v.isDragging),
          draggedBandId: v.draggedBandId ?? null,
        }));
      useCollabStore.getState().setOthers(others);
    });

    function handleMouseMove(e: MouseEvent) {
      const now = Date.now();
      if (now - lastCursorSentRef.current < THROTTLE_MS) return;
      lastCursorSentRef.current = now;
      void update(myRef, { cursor: { x: e.clientX, y: e.clientY }, updatedAt: serverTimestamp() });
    }
    window.addEventListener("mousemove", handleMouseMove);

    // Mirrors this client's OWN drag state (written to useCollabStore by
    // App.tsx's DndContext handlers, with zero Firebase dependency there
    // — see useCollabStore.ts) into RTDB whenever it changes.
    const unsubscribeDragState = useCollabStore.subscribe((state, prev) => {
      if (state.myDragState === prev.myDragState) return;
      void update(myRef, { ...state.myDragState, updatedAt: serverTimestamp() });
    });

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      unsubscribe();
      unsubscribeDragState();
      void disconnectHandle.cancel();
      void remove(myRef);
      useCollabStore.getState().setOthers([]);
    };
  }, [roomId, nickname]);
}
