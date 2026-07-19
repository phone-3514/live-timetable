const ADMIN_AUTH_STORAGE_KEY = "live-timetable-admin-auth";

// Same sessionStorage (tab-scoped) pattern as roomAuth.ts, for the same
// reasons — "admin for the duration of this tab" is the whole scope,
// nothing here should survive a closed tab. IMPORTANT, same caveat as
// VITE_ROOM_PASSWORD but with higher stakes: VITE_ADMIN_PASSWORD is
// baked into the public client bundle like any other VITE_-prefixed
// value, so this flag being "true" only ever means "this tab typed the
// string that matches the bundle" — it is not real authorization, and
// unlike the room password (which only gates *reading*), granting
// yourself this flag also grants a *destructive* capability against
// other connected clients (see useLivePresence.ts's kickUser). See
// PasswordGate.tsx/NicknameEntryModal.tsx for where this is disclosed
// to the user in the UI itself, not just in code comments.
export function readAdminAuthFlag(): boolean {
  try {
    return sessionStorage.getItem(ADMIN_AUTH_STORAGE_KEY) === "true";
  } catch (err) {
    console.error("[adminAuth] sessionStorage read failed, defaulting to non-admin", err);
    return false;
  }
}

export function storeAdminAuthFlag() {
  try {
    sessionStorage.setItem(ADMIN_AUTH_STORAGE_KEY, "true");
  } catch (err) {
    console.error("[adminAuth] sessionStorage write failed (admin flag will not persist across reload)", err);
  }
}

export function clearAdminAuthFlag() {
  try {
    sessionStorage.removeItem(ADMIN_AUTH_STORAGE_KEY);
  } catch (err) {
    console.error("[adminAuth] sessionStorage clear failed", err);
  }
}
