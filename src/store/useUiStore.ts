import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AppTab = "timetable" | "applications";

type UiState = {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
};

// Persisted separately from useAppStore/useApplicationStore since it's pure
// navigation state, not domain data — but still small enough to fold into a
// backup file (see utils/backup.ts) so restoring a backup can put the user
// back on the tab they were viewing when they exported it.
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      activeTab: "timetable",
      setActiveTab: (tab) => set({ activeTab: tab }),
    }),
    { name: "live-timetable-ui" },
  ),
);
