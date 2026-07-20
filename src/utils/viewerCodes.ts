import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";

const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const NAVIGATION_RESOLUTION_PREFIX = "live-timetable-viewer-resolution-";
const NAVIGATION_RESOLUTION_TTL_MS = 60_000;

function shiftedCode(roomId: string, offset: number): string {
  return roomId.toLowerCase().split("").map((character) => {
    const index = CODE_ALPHABET.indexOf(character);
    return index < 0 ? character : CODE_ALPHABET[(index + offset) % CODE_ALPHABET.length];
  }).join("");
}

export async function ensureViewerCode(organizerRoomId: string): Promise<string> {
  if (!db) throw new Error("Firestore is unavailable");
  const existing = await getDoc(doc(db, "roomViewerCodes", organizerRoomId));
  const savedCode = existing.data()?.viewerCode;
  if (typeof savedCode === "string" && /^[a-z0-9]{8}$/.test(savedCode) && savedCode !== organizerRoomId) {
    return savedCode;
  }

  for (let offset = 1; offset < CODE_ALPHABET.length; offset += 1) {
    const viewerCode = shiftedCode(organizerRoomId, offset);
    if (viewerCode === organizerRoomId) continue;
    const [viewerMapping, organizerCollision] = await Promise.all([
      getDoc(doc(db, "viewerCodes", viewerCode)),
      getDoc(doc(db, "rooms", viewerCode)),
    ]);
    const mappedRoom = viewerMapping.data()?.organizerRoomId;
    if (organizerCollision.exists() || (viewerMapping.exists() && mappedRoom !== organizerRoomId)) continue;
    await Promise.all([
      setDoc(doc(db, "viewerCodes", viewerCode), { organizerRoomId }),
      setDoc(doc(db, "roomViewerCodes", organizerRoomId), { viewerCode }),
    ]);
    return viewerCode;
  }
  throw new Error("Unable to allocate viewer code");
}

export async function resolveViewerCode(viewerCode: string): Promise<string | null> {
  if (!db) return null;
  const snapshot = await getDoc(doc(db, "viewerCodes", viewerCode));
  const organizerRoomId = snapshot.data()?.organizerRoomId;
  return typeof organizerRoomId === "string" ? organizerRoomId : null;
}

// Entry validation and the public route are separated by a full navigation.
// Hand the already-verified mapping across that one navigation so the public
// route does not immediately repeat the same Firestore read. The value is
// consumed once and expires quickly; a direct URL or later refresh still
// resolves normally from Firestore.
export function rememberViewerCodeResolution(viewerCode: string, organizerRoomId: string) {
  try {
    sessionStorage.setItem(
      NAVIGATION_RESOLUTION_PREFIX + viewerCode,
      JSON.stringify({ organizerRoomId, savedAt: Date.now() }),
    );
  } catch {
    // Storage may be unavailable. The public route will resolve normally.
  }
}

export function readRememberedViewerCodeResolution(viewerCode: string): string | null {
  try {
    const key = NAVIGATION_RESOLUTION_PREFIX + viewerCode;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as { organizerRoomId?: unknown; savedAt?: unknown };
    if (
      typeof value.organizerRoomId !== "string"
      || !/^[a-z0-9]{8}$/.test(value.organizerRoomId)
      || typeof value.savedAt !== "number"
      || Date.now() - value.savedAt > NAVIGATION_RESOLUTION_TTL_MS
    ) return null;
    return value.organizerRoomId;
  } catch {
    return null;
  }
}

export function forgetRememberedViewerCodeResolution(viewerCode: string) {
  try {
    sessionStorage.removeItem(NAVIGATION_RESOLUTION_PREFIX + viewerCode);
  } catch {
    // Storage may be unavailable; the short TTL still limits reuse.
  }
}

export async function organizerRoomExists(code: string): Promise<boolean> {
  if (!db) return false;
  return (await getDoc(doc(db, "rooms", code))).exists();
}

// Code separation is a navigation boundary, not authentication: without
// Firebase Auth, anyone who obtains an organizer code can still edit.
