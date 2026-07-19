import { useEffect, useRef } from "react";
import { onDisconnect, onValue, ref, remove, serverTimestamp, update } from "firebase/database";
import { rtdb } from "../firebase";
import { useCollabStore, type PresenceEntry } from "../store/useCollabStore";
import { useIsMobile } from "./useViewport";

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

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

type RawPresenceValue = {
  nickname?: string;
  cursor?: { xPct: number; yPct: number } | null;
  isDragging?: boolean;
  draggedBandId?: string | null;
  hoveredElementId?: string | null;
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
  // A touch drag doesn't fire continuous mousemove the way a real mouse
  // does — browsers only synthesize a single mousemove (as part of the
  // tap->mousedown->mousemove->mouseup->click compatibility sequence)
  // after a tap lifts, not throughout a touch-drag. Broadcasting that
  // one stray, physically-meaningless coordinate read as an "erratic,
  // jumping" cursor to desktop viewers (LiveCursors is desktop-only
  // already — see CollabRoot.tsx — but nothing stopped a MOBILE sender
  // from still publishing one). Gating the listener itself off (not
  // just skipping the RTDB write inside the handler) also means a touch
  // interaction never triggers the handler at all, satisfying "no
  // touchmove/touchstart/pointermove should cause presence writes" —
  // there was never a separate touch-specific listener to remove, only
  // this one shared mousemove path.
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!roomId || !nickname || !rtdb) {
      console.log(
        "[useLivePresence] 6. Not connecting yet — roomId:",
        roomId,
        "nickname:",
        nickname,
        "rtdb configured:",
        rtdb !== null,
      );
      useCollabStore.getState().setOthers([]);
      return;
    }
    console.log("[useLivePresence] 6. Room + nickname ready — connecting to RTDB presence");

    const myRef = ref(rtdb, `presence/${roomId}/${clientIdRef.current}`);
    const roomRef = ref(rtdb, `presence/${roomId}`);

    update(myRef, {
      nickname,
      cursor: null,
      isDragging: false,
      draggedBandId: null,
      hoveredElementId: null,
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
          hoveredElementId: v.hoveredElementId ?? null,
        }));
      useCollabStore.getState().setOthers(others);
    });

    function handleMouseMove(e: MouseEvent) {
      const now = Date.now();
      if (now - lastCursorSentRef.current < THROTTLE_MS) return;
      lastCursorSentRef.current = now;
      // Broadcast as a fraction of THIS client's own viewport, not raw
      // pixels — a desktop cursor's clientX/clientY is meaningless on a
      // narrower mobile viewer's screen otherwise (see PresenceEntry.cursor).
      const xPct = clamp01(e.clientX / window.innerWidth);
      const yPct = clamp01(e.clientY / window.innerHeight);
      void update(myRef, { cursor: { xPct, yPct }, updatedAt: serverTimestamp() });
    }
    // Mobile senders keep `cursor: null` (its seeded value below) for
    // their entire session — never attaching the listener at all, rather
    // than attaching it and filtering inside the handler, is what
    // guarantees zero RTDB writes from any mobile pointer/touch activity.
    if (!isMobile) {
      window.addEventListener("mousemove", handleMouseMove);
    }

    // Clears hover the instant this tab stops being the visible one —
    // switching apps/tabs or minimizing doesn't fire mouseleave (the
    // cursor never actually left the element, the whole window just lost
    // focus), so without this a hover badge could keep showing on other
    // collaborators' screens for however long this tab sits in the
    // background. onDisconnect below still covers an outright close/
    // network loss; this covers the "stepped away without closing
    // anything" case the request specifically called out.
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        useCollabStore.getState().setMyHoveredElementId(null);
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Mirrors this client's OWN drag state (written to useCollabStore by
    // App.tsx's DndContext handlers, with zero Firebase dependency there
    // — see useCollabStore.ts) into RTDB whenever it changes.
    const unsubscribeDragState = useCollabStore.subscribe((state, prev) => {
      if (state.myDragState === prev.myDragState) return;
      void update(myRef, { ...state.myDragState, updatedAt: serverTimestamp() });
    });

    // Mirrors this client's OWN hovered-band id (written to useCollabStore
    // by SlotCard's onMouseEnter/onMouseLeave, again with zero Firebase
    // dependency there) into RTDB whenever it changes — the element-id
    // equivalent of the cursor mousemove broadcast above. No throttling:
    // enter/leave already fires at most once per card transition, nowhere
    // near mousemove's rate.
    const unsubscribeHover = useCollabStore.subscribe((state, prev) => {
      if (state.myHoveredElementId === prev.myHoveredElementId) return;
      void update(myRef, {
        hoveredElementId: state.myHoveredElementId,
        updatedAt: serverTimestamp(),
      });
    });

    return () => {
      // Harmless no-op if isMobile meant this was never added — removing
      // a listener that isn't registered is a normal, silent DOM no-op.
      window.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      unsubscribe();
      unsubscribeDragState();
      unsubscribeHover();
      void disconnectHandle.cancel();
      void remove(myRef);
      useCollabStore.getState().setOthers([]);
    };
    // isMobile is intentionally included: crossing the breakpoint (a
    // tablet rotating, a desktop browser window being resized narrow)
    // re-runs this effect, so cursor broadcasting starts/stops live
    // rather than being fixed for the tab's whole lifetime.
  }, [roomId, nickname, isMobile]);
}
