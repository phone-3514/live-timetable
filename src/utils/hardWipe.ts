// Called by CollabRoot.tsx when this client is force-kicked from a room
// (see useCollabStore.ts's `kicked` flag) or explicitly logs out. Per an
// explicit product decision — this reverses an earlier, also-explicit
// decision to preserve a recoverable backup; the user was told directly
// that a local-only backup isn't actually an access-control gap in an
// app with no backend and public-read Firestore rules, and chose this
// anyway — this leaves NOTHING recoverable: no backup file, no
// second localStorage key, nothing. Every storage mechanism the browser
// exposes to this origin is cleared, then the page hard-reloads to a
// bare URL so no in-memory JS state survives either.
//
// This is a one-way door. Nothing calls this except the kick/logout flow
// in CollabRoot.tsx, and it should stay that way — anything else that
// wants to "reset to blank" (a brand-new local event, restoring a
// backup) has its own, non-destructive path (see backup.ts's
// restoreBackup, or useAppStore's own actions) that doesn't take out
// unrelated data.
export async function hardWipeAndRedirect(): Promise<void> {
  // A blocking native dialog rather than a toast: the page is about to
  // hard-reload immediately after this, which would tear down a toast
  // mid-fade before it could be read. alert() guarantees the message is
  // actually seen before the screen goes blank.
  alert(
    "管理者によってルームから退出させられました。このデバイスに保存されていたデータはすべて完全に削除されます。",
  );

  try {
    localStorage.clear();
  } catch (err) {
    console.error("[hardWipe] localStorage.clear() failed", err);
  }

  try {
    sessionStorage.clear();
  } catch (err) {
    console.error("[hardWipe] sessionStorage.clear() failed", err);
  }

  // Firestore's persistentLocalCache (see firebase.ts) stores its
  // offline cache in IndexedDB — this is the one storage mechanism a
  // plain localStorage/sessionStorage clear doesn't touch. Deleting by
  // enumerating indexedDB.databases() (rather than hardcoding Firestore's
  // internal database name) also catches anything else the app or its
  // dependencies might ever store there.
  try {
    if ("indexedDB" in window && "databases" in indexedDB) {
      const dbs = await indexedDB.databases();
      await Promise.all(
        dbs.map(
          (db) =>
            new Promise<void>((resolve) => {
              if (!db.name) {
                resolve();
                return;
              }
              const req = indexedDB.deleteDatabase(db.name);
              req.onsuccess = () => resolve();
              req.onerror = () => resolve();
              req.onblocked = () => resolve();
            }),
        ),
      );
    }
  } catch (err) {
    console.error("[hardWipe] IndexedDB wipe failed", err);
  }

  // The PWA shell and static assets live in Cache Storage. Clear them as
  // part of the same one-way wipe so this device retains no app data.
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch (err) {
    console.error("[hardWipe] Cache Storage wipe failed", err);
  }

  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch (err) {
    console.error("[hardWipe] Service worker unregister failed", err);
  }

  // Hard navigation, not a React state reset — every persist-backed
  // Zustand store rehydrates from (now-empty) localStorage on the fresh
  // load, landing on the blank entry form with zero in-memory state left
  // over from before. Stripped to origin + pathname so no ?room=... (or
  // anything else) survives into the reloaded URL.
  window.location.href = window.location.origin + window.location.pathname;
}
