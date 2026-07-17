import { create } from "zustand";
import { useAppStore } from "./useAppStore";
import type { Band, TimetableDay } from "../types";

type Snapshot = { bands: Band[]; days: TimetableDay[]; at: number };

type HistoryState = {
  past: Snapshot[];
  future: Snapshot[];
  undo: () => void;
  redo: () => void;
  /** Jump straight to a specific point in `past` (0 = oldest) — the "click
   * any point in the history to restore it" affordance from the History
   * panel, rather than stepping back one at a time. */
  jumpToPast: (index: number) => void;
};

// A deliberately simplified linear undo/redo — not the full branching
// history tree a Figma-style implementation would have (every past state
// reachable, redo branches preserved when you undo then make a new edit).
// This is a single past/future stack: making a new edit after an undo
// discards the redo branch, same as browser back/forward. Good enough for
// "I misclicked, get me back" without the complexity of a real DAG.
const MAX_HISTORY = 50;

// Guards the subscriber below from recording our own undo/redo writes as
// new history entries, which would otherwise make undo un-undoable.
let isApplyingHistory = false;

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],

  undo: () => {
    const { past } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    const current: Snapshot = {
      bands: useAppStore.getState().bands,
      days: useAppStore.getState().days,
      at: Date.now(),
    };
    isApplyingHistory = true;
    useAppStore.setState({ bands: prev.bands, days: prev.days });
    isApplyingHistory = false;
    set((s) => ({ past: s.past.slice(0, -1), future: [current, ...s.future] }));
  },

  redo: () => {
    const { future } = get();
    if (future.length === 0) return;
    const next = future[0];
    const current: Snapshot = {
      bands: useAppStore.getState().bands,
      days: useAppStore.getState().days,
      at: Date.now(),
    };
    isApplyingHistory = true;
    useAppStore.setState({ bands: next.bands, days: next.days });
    isApplyingHistory = false;
    set((s) => ({ future: s.future.slice(1), past: [...s.past, current] }));
  },

  jumpToPast: (index) => {
    const { past } = get();
    const target = past[index];
    if (!target) return;
    const current: Snapshot = {
      bands: useAppStore.getState().bands,
      days: useAppStore.getState().days,
      at: Date.now(),
    };
    // Everything after the target point becomes "future" (in reverse, so
    // the immediately-more-recent state is first — consistent with how a
    // single undo() would have produced this same future ordering one
    // step at a time), everything before it stays "past".
    const displaced = [...past.slice(index + 1), current].reverse();
    isApplyingHistory = true;
    useAppStore.setState({ bands: target.bands, days: target.days });
    isApplyingHistory = false;
    set((s) => ({ past: past.slice(0, index), future: [...displaced, ...s.future] }));
  },
}));

// Records a checkpoint (the state as it was *before* the change) every time
// useAppStore's bands or days actually change — scoped to just those two
// fields since this is specifically "undo for timetable placement," not a
// whole-app undo that would also churn on every keystroke in the venue-name
// field. A brand-new user action after an undo clears `future`, matching
// standard undo/redo semantics (browser back/forward, most editors).
let lastBands = useAppStore.getState().bands;
let lastDays = useAppStore.getState().days;
useAppStore.subscribe((state) => {
  if (isApplyingHistory) {
    lastBands = state.bands;
    lastDays = state.days;
    return;
  }
  if (state.bands !== lastBands || state.days !== lastDays) {
    const snapshot: Snapshot = { bands: lastBands, days: lastDays, at: Date.now() };
    useHistoryStore.setState((s) => ({
      past: [...s.past, snapshot].slice(-MAX_HISTORY),
      future: [],
    }));
    lastBands = state.bands;
    lastDays = state.days;
  }
});
