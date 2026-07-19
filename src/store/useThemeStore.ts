import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemePreference = "system" | "light" | "dark";

type ThemeState = {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  /** system -> light -> dark -> system — the header toggle's single
   * button cycles through this order rather than exposing a 3-way
   * picker, since "follow the OS" is a real, worth-keeping option, not
   * just a temporary default to click past. */
  cycleTheme: () => void;
};

// Persisted (see index.html's inline pre-paint script, which reads this
// exact key/shape directly from localStorage before React ever mounts,
// to avoid a flash of the wrong theme on load) but otherwise ordinary —
// applying `theme` to the DOM (the `data-theme` attribute index.css's
// `:root[data-theme=...]` overrides key off) is ThemeEffect's job, not
// this store's; this only holds the preference itself.
export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "system",
      setTheme: (theme) => set({ theme }),
      cycleTheme: () => {
        const order: ThemePreference[] = ["system", "light", "dark"];
        const next = order[(order.indexOf(get().theme) + 1) % order.length];
        set({ theme: next });
      },
    }),
    { name: "live-timetable-theme" },
  ),
);
