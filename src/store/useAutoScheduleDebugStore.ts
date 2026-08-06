import { create } from "zustand";
import type { SchedulingDebugResult } from "../utils/autoScheduleSolver";

export type AutoScheduleDebugEntry = {
  dayId: string;
  dayLabel: string;
  result: SchedulingDebugResult;
};

type AutoScheduleDebugState = {
  entries: AutoScheduleDebugEntry[];
  setEntries: (entries: AutoScheduleDebugEntry[]) => void;
  clear: () => void;
};

// 管理者専用「スコア詳細」の唯一の保持場所 — 意図的にpersist middlewareを
// 使わないプレーンなstoreで、次回の一括自動配置(または画面のリロード)まで
// メモリ上にだけ残る。Firestore/Realtime Database/localStorage/IndexedDB
// のいずれにも書き込まない(ライブ構成評価やスコア内訳は管理者専用の
// 内部情報のため — see AutoScheduleDebugModal.tsx / useAppStore.ts's
// autoScheduleAllDays).
export const useAutoScheduleDebugStore = create<AutoScheduleDebugState>((set) => ({
  entries: [],
  setEntries: (entries) => set({ entries }),
  clear: () => set({ entries: [] }),
}));
