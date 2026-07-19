import { useEffect } from "react";
import { useThemeStore } from "../store/useThemeStore";

// Keeps <html data-theme="..."> in sync with useThemeStore after the
// initial load (index.html's own inline script handles BEFORE first
// paint, straight from localStorage, to avoid a flash of the wrong theme
// — this is what makes the header toggle take effect live afterward
// without needing a reload). "system" removes the attribute entirely
// rather than setting it to some third value — index.css's plain
// `@media (prefers-color-scheme)` rule is only reachable when no
// [data-theme] override is present at all. Shared by both the main editor
// (App.tsx) and the public pamphlet route (PublicPamphletRoot.tsx) — both
// render under the same <html>, so both need this, and it has zero
// admin/editing dependency of its own (useThemeStore is a plain,
// Firebase-free Zustand store).
export function useSyncThemeAttribute() {
  const themePreference = useThemeStore((s) => s.theme);
  useEffect(() => {
    if (themePreference === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", themePreference);
    }
  }, [themePreference]);
}
