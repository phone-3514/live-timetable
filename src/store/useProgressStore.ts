import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { organizerStateStorage } from "../utils/appRoleStorage";

export type StagePhase = "standby" | "performing" | "transition" | "break" | "finished";

export type ProgressLogEntry = {
  id: string;
  at: number;
  actor: string;
  action: string;
  before: string;
  after: string;
  dayId: string | null;
  slotId: string | null;
};

export type StageProgress = {
  dayId: string | null;
  slotId: string | null;
  phase: StagePhase;
  updatedAt: number;
  updatedBy: string;
};

type ProgressState = StageProgress & {
  logs: ProgressLogEntry[];
  setProgress: (partial: Partial<Pick<StageProgress, "dayId" | "slotId" | "phase">>, actor: string, action: string) => void;
  hydrateProgress: (progress: StageProgress | null) => void;
};

const EMPTY_PROGRESS: StageProgress = {
  dayId: null,
  slotId: null,
  phase: "standby",
  updatedAt: 0,
  updatedBy: "",
};

const PHASE_NAME: Record<StagePhase, string> = {
  standby: "待機中",
  performing: "出演中",
  transition: "転換中",
  break: "休憩・イベント中",
  finished: "終演",
};

export const useProgressStore = create<ProgressState>()(
  persist(
    (set) => ({
      ...EMPTY_PROGRESS,
      logs: [],
      setProgress: (partial, actor, action) =>
        set((state) => {
          const updatedAt = Date.now();
          const next = { ...state, ...partial, updatedAt, updatedBy: actor };
          const log: ProgressLogEntry = {
            id: crypto.randomUUID(),
            at: updatedAt,
            actor,
            action,
            before: `${PHASE_NAME[state.phase]}${state.slotId !== next.slotId ? "（前の枠）" : ""}`,
            after: `${PHASE_NAME[next.phase]}${state.slotId !== next.slotId ? "（次の枠）" : ""}`,
            dayId: next.dayId,
            slotId: next.slotId,
          };
          return { ...partial, updatedAt, updatedBy: actor, logs: [...state.logs, log].slice(-100) };
        }),
      hydrateProgress: (progress) => set(progress ?? EMPTY_PROGRESS),
    }),
    { name: "live-timetable-progress", storage: createJSONStorage(() => organizerStateStorage) },
  ),
);

export function getStageProgress(): StageProgress {
  const { dayId, slotId, phase, updatedAt, updatedBy } = useProgressStore.getState();
  return { dayId, slotId, phase, updatedAt, updatedBy };
}
