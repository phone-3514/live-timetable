import type { StateStorage } from "zustand/middleware";

export type AppRole = "organizer" | "viewer";
let currentRole: AppRole = new URLSearchParams(window.location.search).has("room") ? "organizer" : "viewer";
const OWNER_KEY = "live-timetable-local-event-owner";
const ORGANIZER_DATA_KEYS = [
  "live-timetable-app",
  "live-timetable-applications",
  "live-timetable-progress",
  "live-timetable-furigana",
  "live-timetable-ui",
];

export function setAppRole(role: AppRole) {
  currentRole = role;
}

export function markLocalEventOwner() {
  try { localStorage.setItem(OWNER_KEY, "true"); } catch { /* local storage unavailable */ }
}

export function isLocalEventOwner(): boolean {
  try { return localStorage.getItem(OWNER_KEY) === "true"; } catch { return false; }
}

export function clearOrganizerLocalData() {
  try {
    ORGANIZER_DATA_KEYS.forEach((key) => localStorage.removeItem(key));
    localStorage.removeItem(OWNER_KEY);
  } catch { /* local storage unavailable */ }
}

function organizerStorageAllowed(): boolean {
  const base = import.meta.env.BASE_URL;
  const relativePath = window.location.pathname.startsWith(base)
    ? window.location.pathname.slice(base.length)
    : window.location.pathname.replace(/^\//, "");
  if (/^[^/]+\/public\/?$/.test(relativePath) || /^pa-viewer\/?$/.test(relativePath)) return false;
  if (new URLSearchParams(window.location.search).has("room")) return true;
  return currentRole === "organizer";
}

// Existing keys and payloads stay unchanged; viewer sessions simply cannot
// read or write the organizer-only persisted stores.
export const organizerStateStorage: StateStorage = {
  getItem: (name) => organizerStorageAllowed() ? localStorage.getItem(name) : null,
  setItem: (name, value) => { if (organizerStorageAllowed()) localStorage.setItem(name, value); },
  removeItem: (name) => { if (organizerStorageAllowed()) localStorage.removeItem(name); },
};
