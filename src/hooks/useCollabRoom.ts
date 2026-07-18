import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useCollabStore } from "../store/useCollabStore";
import type { Band, TimetableDay } from "../types";
import { DEFAULT_VENUE_HOURS, type VenueHours } from "../utils/parseBands";
import { useFirestoreDocSync } from "./useFirestoreSync";

const ROOM_PARAM = "room";

export type RoomDoc = {
  liveName: string;
  venue: string;
  organizationName: string;
  venueHours: VenueHours;
  bands: Band[];
  days: TimetableDay[];
  updatedAt: number;
};

const EMPTY_ROOM: RoomDoc = {
  liveName: "",
  venue: "",
  organizationName: "",
  venueHours: DEFAULT_VENUE_HOURS,
  bands: [],
  days: [],
  updatedAt: 0,
};

function readRoomIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get(ROOM_PARAM);
}

// Short and URL-safe; collision risk is irrelevant at the scale this
// gets used at (a handful of rooms ever created by one club).
function generateRoomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function snapshotFromStore(): Omit<RoomDoc, "updatedAt"> {
  const s = useAppStore.getState();
  return {
    liveName: s.eventInfo.liveName,
    venue: s.eventInfo.venue,
    organizationName: s.eventInfo.organizationName,
    venueHours: s.venueHours,
    bands: s.bands,
    days: s.days,
  };
}

function applyRoomDocToStore(doc: RoomDoc) {
  useAppStore.setState({
    bands: doc.bands,
    days: doc.days,
    eventInfo: {
      liveName: doc.liveName,
      venue: doc.venue,
      organizationName: doc.organizationName,
    },
    venueHours: doc.venueHours,
  });
}

/**
 * Real-time collaborative editing: joining a room (via ?room=<id> in the
 * URL) mirrors useAppStore's bands/days/eventInfo/venueHours to and from
 * one Firestore document per room (see firestore.rules). No room in the
 * URL means the app behaves exactly as it always has — fully local,
 * zero Firestore traffic — so this is opt-in per session, not a
 * always-on migration of the existing local-first architecture.
 *
 * Sync direction is handled by two effects plus a one-time handshake:
 *   1. On first connecting to a room, either seed Firestore from the
 *      current local state (brand-new room, updatedAt === 0) or replace
 *      local state with the room's existing data (joining an
 *      already-started room).
 *   2. After that handshake, local store changes push to Firestore
 *      (debounced — see useFirestoreDocSync) and remote changes from
 *      other collaborators apply back to the local store.
 * `suppressPushRef` and `lastAppliedUpdatedAt` exist purely to stop
 * those two directions from echoing into an infinite feedback loop —
 * see their comments below.
 */
export function useCollabRoom() {
  const [roomId, setRoomIdState] = useState<string | null>(() => readRoomIdFromUrl());
  const { data, update, updateNow, status } = useFirestoreDocSync<RoomDoc>(
    roomId ? `rooms/${roomId}` : null,
    EMPTY_ROOM,
  );

  // Has the one-time join handshake (seed-or-replace) completed for the
  // CURRENT roomId? Reset whenever roomId itself changes.
  const hydratedRef = useRef(false);
  // True while THIS hook is the one applying a remote doc onto
  // useAppStore — the local-store-subscribe effect checks this so that
  // applying a remote update doesn't get immediately re-pushed back to
  // Firestore as if it were a brand new local edit.
  const suppressPushRef = useRef(false);
  // The last updatedAt value this client has already applied or itself
  // pushed — lets the remote-listener effect ignore its own write
  // echoing back confirmed from the server (see useFirestoreDocSync's
  // hasPendingWrites gate — that skips the OPTIMISTIC echo, but the
  // later server-confirmed snapshot still comes through as a normal
  // update and would otherwise look identical to a genuine change from
  // another collaborator).
  const lastKnownUpdatedAt = useRef(0);

  useEffect(() => {
    hydratedRef.current = false;
    lastKnownUpdatedAt.current = 0;
  }, [roomId]);

  // 1. Join handshake.
  useEffect(() => {
    if (!roomId || hydratedRef.current || status !== "synced") return;
    hydratedRef.current = true;
    const isNewRoom = data.updatedAt === 0;
    if (isNewRoom) {
      const updatedAt = Date.now();
      lastKnownUpdatedAt.current = updatedAt;
      updateNow(() => ({ ...snapshotFromStore(), updatedAt }));
    } else {
      lastKnownUpdatedAt.current = data.updatedAt;
      suppressPushRef.current = true;
      applyRoomDocToStore(data);
      queueMicrotask(() => {
        suppressPushRef.current = false;
      });
    }
  }, [roomId, status, data, updateNow]);

  // 2a. Local -> remote.
  useEffect(() => {
    if (!roomId) return;
    return useAppStore.subscribe((state, prev) => {
      if (!hydratedRef.current || suppressPushRef.current) return;
      const changed =
        state.bands !== prev.bands ||
        state.days !== prev.days ||
        state.eventInfo !== prev.eventInfo ||
        state.venueHours !== prev.venueHours;
      if (!changed) return;
      const updatedAt = Date.now();
      lastKnownUpdatedAt.current = updatedAt;
      update(() => ({ ...snapshotFromStore(), updatedAt }));
    });
  }, [roomId, update]);

  // 2b. Remote -> local.
  useEffect(() => {
    if (!roomId || !hydratedRef.current) return;
    if (data.updatedAt === lastKnownUpdatedAt.current) return;
    lastKnownUpdatedAt.current = data.updatedAt;
    suppressPushRef.current = true;
    applyRoomDocToStore(data);
    queueMicrotask(() => {
      suppressPushRef.current = false;
    });
  }, [roomId, data]);

  // Publishes into the shared, Firebase-free useCollabStore so ordinary
  // (main-bundle) components like SlotCard can read roomId/status without
  // ever importing this hook or firebase.ts themselves.
  useEffect(() => {
    useCollabStore.getState().setRoomState(roomId, status);
  }, [roomId, status]);

  const startRoom = useCallback(() => {
    const id = generateRoomId();
    const url = new URL(window.location.href);
    url.searchParams.set(ROOM_PARAM, id);
    window.history.replaceState(null, "", url.toString());
    setRoomIdState(id);
  }, []);

  const leaveRoom = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete(ROOM_PARAM);
    window.history.replaceState(null, "", url.toString());
    setRoomIdState(null);
  }, []);

  return {
    roomId,
    status,
    startRoom,
    leaveRoom,
  };
}
