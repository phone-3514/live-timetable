const NICKNAME_STORAGE_KEY = "live-timetable-nickname";

// sessionStorage, not localStorage — a nickname is meaningless once the
// tab closes, which is also exactly when RTDB's onDisconnect cleans up
// this client's presence record (see useLivePresence).
//
// Wrapped in try/catch: sessionStorage access itself (not just parsing —
// there's no JSON here, it's a plain string) can throw a SecurityError in
// some real browser contexts (Safari private browsing blocks Storage
// access entirely, some embedded/sandboxed iframes disallow it too).
// Treating that as "no nickname yet" / "couldn't save it" degrades to
// re-asking every reload rather than crashing app init.
export function readStoredNickname(): string | null {
  console.log("[nickname] 0. Reading stored nickname from sessionStorage");
  try {
    return sessionStorage.getItem(NICKNAME_STORAGE_KEY);
  } catch (err) {
    console.error("[nickname] sessionStorage read failed, defaulting to no nickname", err);
    return null;
  }
}

export function storeNickname(nickname: string) {
  try {
    sessionStorage.setItem(NICKNAME_STORAGE_KEY, nickname);
  } catch (err) {
    console.error("[nickname] sessionStorage write failed (nickname will not persist across reload)", err);
  }
}
