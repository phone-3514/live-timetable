import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { normalizeMemberName } from "../utils/normalizeMemberName";
import { organizerStateStorage } from "../utils/appRoleStorage";

export type FuriganaImportEntry = { name: string; furigana: string };

type FuriganaState = {
  /** normalizeMemberName(name) -> furigana. Deliberately the ONLY shape
   * this store can ever hold — nothing else from an imported master sheet
   * (address, phone number, etc.) has a field to land in, so it can't end
   * up here or in this store's localStorage persistence even by accident. */
  furiganaByKey: Record<string, string>;
  importFurigana: (entries: FuriganaImportEntry[]) => number;
  clearFurigana: () => void;
};

export const useFuriganaStore = create<FuriganaState>()(
  persist(
    (set) => ({
      furiganaByKey: {},
      importFurigana: (entries) => {
        let count = 0;
        set((state) => {
          const next = { ...state.furiganaByKey };
          for (const { name, furigana } of entries) {
            const key = normalizeMemberName(name);
            if (!key || !furigana.trim()) continue;
            next[key] = furigana.trim();
            count++;
          }
          return { furiganaByKey: next };
        });
        return count;
      },
      clearFurigana: () => set({ furiganaByKey: {} }),
    }),
    { name: "live-timetable-furigana", storage: createJSONStorage(() => organizerStateStorage) },
  ),
);
