import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useApplicationStore } from "../store/useApplicationStore";
import { useCollabStore } from "../store/useCollabStore";
import type { Application, Band, TimetableDay } from "../types";
import { DEFAULT_VENUE_HOURS, type VenueHours } from "../utils/parseBands";
import { useFirestoreDocSync } from "./useFirestoreSync";

const ROOM_PARAM = "room";
type RoomEntryMode = "create" | "join";

export type RoomDoc = {
  liveName: string;
  venue: string;
  organizationName: string;
  venueHours: VenueHours;
  bands: Band[];
  days: TimetableDay[];
  // 出演申し込み管理 (Application Manager) data — a separate Zustand store
  // (useApplicationStore) from bands/days, but synced through this same
  // one-document-per-room model rather than a second Firestore document:
  // it's still "everything in this room," and an approved application's
  // linkedBandId already cross-references the band it became, so keeping
  // both in the same write/read cycle is what keeps that reference
  // consistent for every collaborator at the same moment.
  applications: Application[];
  updatedAt: number;
};

const EMPTY_ROOM: RoomDoc = {
  liveName: "",
  venue: "",
  organizationName: "",
  venueHours: DEFAULT_VENUE_HOURS,
  bands: [],
  days: [],
  applications: [],
  updatedAt: 0,
};

function readRoomIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get(ROOM_PARAM);
}

// Eight characters, easy to read aloud/type, and free of ambiguous
// I/O/0/1 glyphs. Stored lowercase for compatibility with existing URLs;
// the UI presents it uppercase as a human-facing share code.
function generateRoomId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("").toLowerCase();
}

function normalizeRoomCode(value: string): string | null {
  const normalized = value.trim().replace(/[\s-]+/g, "").toLowerCase();
  return /^[a-z0-9]{8}$/.test(normalized) ? normalized : null;
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
    applications: useApplicationStore.getState().applications,
  };
}

// A Firestore document is untyped data at rest — `snapshot.data() as T` in
// useFirestoreDocSync trusts the cast, but a doc written by an older
// client version, a partial/interrupted write, or manual console editing
// could be missing fields entirely. Defaulting every field here (never
// trusting `doc.bands`/`doc.days` to actually be arrays) is what stands
// between that and useAppStore.setState({ bands: undefined, ... }) —
// which would crash every `bands.map(...)`/`days.map(...)` in the app on
// the very next render.
// Small helper for the payload-inspection logs below — pulls out
// exactly the part/grade shape so a console reader doesn't have to dig
// through a full bands array dump to answer "did this payload actually
// carry part/grade."
function summarizeMemberFields(bands: Band[] | undefined) {
  return (bands ?? []).flatMap(
    (b) => b.memberDetails?.map((m) => ({ band: b.name, name: m.name, grade: m.grade, part: m.part })) ?? [],
  );
}

function applyRoomDocToStore(doc: RoomDoc) {
  console.log(
    "[useCollabRoom] onSnapshot: applying room doc to store — bands:",
    doc.bands?.length,
    "days:",
    doc.days?.length,
    "applications:",
    doc.applications?.length,
  );
  console.log("[useCollabRoom] onSnapshot: member grade/part in payload:", summarizeMemberFields(doc.bands));
  useAppStore.setState({
    bands: doc.bands ?? [],
    days: doc.days ?? [],
    eventInfo: {
      liveName: doc.liveName ?? "",
      venue: doc.venue ?? "",
      organizationName: doc.organizationName ?? "",
    },
    venueHours: doc.venueHours ?? DEFAULT_VENUE_HOURS,
  });
  useApplicationStore.setState({ applications: doc.applications ?? [] });
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
export function useCollabRoom(isAuthenticated: boolean) {
  const initialRoomId = readRoomIdFromUrl();
  const [roomId, setRoomIdState] = useState<string | null>(initialRoomId);
  const [entryMode, setEntryMode] = useState<RoomEntryMode | null>(initialRoomId ? "join" : null);
  const [joinError, setJoinError] = useState<string | null>(null);
  // The password gate (see PasswordGate.tsx/CollabRoot.tsx) works by
  // keeping this path null — and therefore useFirestoreDocSync's
  // onSnapshot never subscribing at all — until isAuthenticated flips
  // true. roomId can already be set (from the URL, or from startRoom()
  // below) while this stays null; every effect further down keys off
  // `status`/`hydratedRef`, which simply never progress past "offline"
  // while the real Firestore path is withheld, so no separate "don't run
  // yet" branching is needed anywhere else in this hook.
  const path = roomId && isAuthenticated ? `rooms/${roomId}` : null;
  const { data, update, updateNow, status, exists, isFromCache } = useFirestoreDocSync<RoomDoc>(path, EMPTY_ROOM);

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
    if (!roomId || hydratedRef.current || status !== "synced" || exists === null) return;
    // An empty persistent cache is not proof that a code is invalid. Wait
    // for Firestore's server-backed snapshot before rejecting a join.
    if (!exists && entryMode !== "create" && isFromCache !== false) return;
    if (!exists && entryMode !== "create") {
      const url = new URL(window.location.href);
      url.searchParams.delete(ROOM_PARAM);
      window.history.replaceState(null, "", url.toString());
      setJoinError("共有コードに一致するイベントが見つかりませんでした");
      setEntryMode(null);
      setRoomIdState(null);
      return;
    }
    hydratedRef.current = true;
    const isNewRoom = !exists;
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
  }, [roomId, status, exists, isFromCache, entryMode, data, updateNow]);

  // 2a. Local -> remote — two independent Zustand stores (useAppStore for
  // bands/days/eventInfo/venueHours, useApplicationStore for Application
  // Manager data), each with its own subscribe callback, but both funnel
  // into the same pushSnapshot so either one changing produces one
  // combined write of the full room doc — matches how snapshotFromStore
  // already reads across both stores in one pass.
  const pushSnapshot = useCallback(() => {
    const updatedAt = Date.now();
    lastKnownUpdatedAt.current = updatedAt;
    const snapshot = snapshotFromStore();
    console.log(
      "[useCollabRoom] write: pushing local state to Firestore — bands:",
      snapshot.bands.length,
      "days:",
      snapshot.days.length,
      "applications:",
      snapshot.applications.length,
    );
    console.log("[useCollabRoom] write: member grade/part in payload:", summarizeMemberFields(snapshot.bands));
    update(() => ({ ...snapshot, updatedAt }));
  }, [update]);

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
      pushSnapshot();
    });
  }, [roomId, pushSnapshot]);

  useEffect(() => {
    if (!roomId) return;
    return useApplicationStore.subscribe((state, prev) => {
      if (!hydratedRef.current || suppressPushRef.current) return;
      if (state.applications === prev.applications) return;
      pushSnapshot();
    });
  }, [roomId, pushSnapshot]);

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
    setJoinError(null);
    setEntryMode("create");
    setRoomIdState(id);
  }, []);

  const joinRoom = useCallback((code: string) => {
    const id = normalizeRoomCode(code);
    if (!id) {
      return false;
    }
    const url = new URL(window.location.href);
    url.searchParams.set(ROOM_PARAM, id);
    window.history.replaceState(null, "", url.toString());
    setJoinError(null);
    setEntryMode("join");
    setRoomIdState(id);
    return true;
  }, []);

  const leaveRoom = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete(ROOM_PARAM);
    window.history.replaceState(null, "", url.toString());
    setJoinError(null);
    setEntryMode(null);
    setRoomIdState(null);
  }, []);

  const clearJoinError = useCallback(() => setJoinError(null), []);

  return {
    roomId,
    status,
    startRoom,
    joinRoom,
    joinError,
    clearJoinError,
    leaveRoom,
  };
}
