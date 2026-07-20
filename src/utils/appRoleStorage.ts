import type { StateStorage } from "zustand/middleware";

export type AppRole = "organizer" | "viewer";
let currentRole: AppRole = new URLSearchParams(window.location.search).has("room") ? "organizer" : "viewer";

export function setAppRole(role: AppRole) {
  currentRole = role;
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
