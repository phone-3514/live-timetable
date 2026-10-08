import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { organizerStateStorage } from "../utils/appRoleStorage";
import type { DeadlineBasis, SimExtra } from "../utils/liveTimeSimulation";
import type { RejectionPolicy } from "../utils/rejectionPolicy";

export type SimulatorSource = "manual" | "timetable" | "applications";

export type SimulatorDayInput = {
  startTime: string;
  performanceMinutes: number;
  transitionMinutes: number;
  manualCount: number;
  /** "" = no deadline set for this day. */
  deadline: string;
};

// Everything the time simulator's screen is made of that the organizer typed
// or picked. The results (end times, slot counts, 却下の目安) are pure
// functions of this plus the timetable and the applications, so saving this is
// what lets a restored backup bring the same simulation back.
export type SimulatorSettings = {
  source: SimulatorSource;
  includePending: boolean;
  basis: DeadlineBasis;
  extrasByDay: Record<string, SimExtra[]>;
  dayInputs: Record<string, SimulatorDayInput>;
  excludedApplyDays: string[];
  applySettings: boolean;
  applyExtras: boolean;
  slotMode: "sim" | "max" | "none";
  replaceOverride: boolean | null;
  plannerIncludePending: boolean;
  /** 却下の目安で誰を残すかの基準。 */
  rejectionPolicy: RejectionPolicy;
};

export const DEFAULT_SIMULATOR_SETTINGS: SimulatorSettings = {
  source: "manual",
  includePending: false,
  basis: "lastBand",
  extrasByDay: {},
  dayInputs: {},
  excludedApplyDays: [],
  applySettings: true,
  applyExtras: true,
  slotMode: "sim",
  replaceOverride: null,
  plannerIncludePending: true,
  rejectionPolicy: "applied",
};

type SimulatorState = {
  settings: SimulatorSettings;
  setField: <K extends keyof SimulatorSettings>(key: K, value: SimulatorSettings[K]) => void;
  /** Replaces everything (backup restore); null/undefined = back to defaults. */
  replaceSettings: (settings: Partial<SimulatorSettings> | null | undefined) => void;
};

// Older or hand-edited backups may lack keys; start from the defaults so a
// missing field never leaves the screen with undefined state.
export function normalizeSimulatorSettings(
  raw: Partial<SimulatorSettings> | null | undefined,
): SimulatorSettings {
  return { ...DEFAULT_SIMULATOR_SETTINGS, ...(raw ?? {}) };
}

export const useSimulatorStore = create<SimulatorState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SIMULATOR_SETTINGS,
      setField: (key, value) => set((state) => ({ settings: { ...state.settings, [key]: value } })),
      replaceSettings: (settings) => set({ settings: normalizeSimulatorSettings(settings) }),
    }),
    {
      name: "live-timetable-simulator",
      storage: createJSONStorage(() => organizerStateStorage),
      partialize: (state) => ({ settings: state.settings }),
      merge: (persisted, current) => ({
        ...current,
        settings: normalizeSimulatorSettings((persisted as Partial<SimulatorState> | undefined)?.settings),
      }),
    },
  ),
);
