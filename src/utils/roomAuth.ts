const ROOM_AUTH_STORAGE_KEY = "live-timetable-room-auth";

// sessionStorage (tab-scoped), matching nickname.ts's own reasoning —
// "logged in for the duration of the tab session" per the feature spec,
// not persisted beyond that. Wrapped in try/catch for the same reason as
// nickname.ts: storage access itself can throw (Safari private browsing,
// sandboxed iframes), and that should degrade to "not authenticated yet"
// rather than crash.
export function readRoomAuthFlag(): boolean {
  try {
    return sessionStorage.getItem(ROOM_AUTH_STORAGE_KEY) === "true";
  } catch (err) {
    console.error("[roomAuth] sessionStorage read failed, defaulting to unauthenticated", err);
    return false;
  }
}

export function storeRoomAuthFlag() {
  try {
    sessionStorage.setItem(ROOM_AUTH_STORAGE_KEY, "true");
  } catch (err) {
    console.error("[roomAuth] sessionStorage write failed (auth will not persist across reload)", err);
  }
}

export function clearRoomAuthFlag() {
  try {
    sessionStorage.removeItem(ROOM_AUTH_STORAGE_KEY);
  } catch (err) {
    console.error("[roomAuth] sessionStorage clear failed", err);
  }
}
