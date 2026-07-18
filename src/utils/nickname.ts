const NICKNAME_STORAGE_KEY = "live-timetable-nickname";

// sessionStorage, not localStorage — a nickname is meaningless once the
// tab closes, which is also exactly when RTDB's onDisconnect cleans up
// this client's presence record (see useLivePresence).
export function readStoredNickname(): string | null {
  return sessionStorage.getItem(NICKNAME_STORAGE_KEY);
}

export function storeNickname(nickname: string) {
  sessionStorage.setItem(NICKNAME_STORAGE_KEY, nickname);
}
