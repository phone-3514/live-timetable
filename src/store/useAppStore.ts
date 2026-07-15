import { create } from "zustand";
import { arrayMove } from "@dnd-kit/sortable";
import type { Band, TimetableSettings, TimetableSlot } from "../types";
import { parseBands } from "../utils/parseBands";
import { minutesToTime, timeToMinutes } from "../utils/time";

type AppState = {
  rawText: string;
  bands: Band[];
  slots: TimetableSlot[];
  settings: TimetableSettings;

  setRawText: (text: string) => void;
  parseFromRawText: () => void;
  updateBand: (id: string, partial: Partial<Band>) => void;
  deleteBand: (id: string) => void;

  addSlot: () => void;
  addCustomSlot: (label: string, durationMinutes: number) => void;
  updateSlot: (
    id: string,
    partial: Partial<Pick<TimetableSlot, "customLabel" | "customDurationMinutes">>,
  ) => void;
  removeSlot: (id: string) => void;
  assignBandToSlot: (bandId: string, slotId: string) => void;
  unassignSlot: (slotId: string) => void;
  moveSlot: (id: string, direction: "up" | "down") => void;
  reorderSlots: (activeId: string, overId: string) => void;
  updateSettings: (partial: Partial<TimetableSettings>) => void;
};

// A band's own durationMinutes (parsed from e.g. "演奏時間：10分") overrides
// the timetable's default performance duration for its slot. Custom rows
// (休憩・集合・リハーサル) use their own customDurationMinutes instead.
function recomputeTimes(
  slots: TimetableSlot[],
  settings: TimetableSettings,
  bands: Band[],
): TimetableSlot[] {
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  let cursor = timeToMinutes(settings.startTime);
  return slots.map((slot) => {
    let duration = settings.performanceMinutes;
    if (slot.bandId) {
      const band = bandMap.get(slot.bandId);
      duration = band?.durationMinutes ?? settings.performanceMinutes;
    } else if (slot.customLabel !== null) {
      duration = slot.customDurationMinutes ?? settings.performanceMinutes;
    }
    const start = cursor;
    const end = start + duration;
    cursor = end + settings.transitionMinutes;
    return { ...slot, startTime: minutesToTime(start), endTime: minutesToTime(end) };
  });
}

export const useAppStore = create<AppState>((set, get) => ({
  rawText: "",
  bands: [],
  slots: [],
  settings: {
    startTime: "10:00",
    performanceMinutes: 20,
    transitionMinutes: 15,
  },

  setRawText: (text) => set({ rawText: text }),

  parseFromRawText: () => {
    const bands = parseBands(get().rawText);
    set({ bands });
  },

  updateBand: (id, partial) =>
    set((state) => {
      const bands = state.bands.map((b) =>
        b.id === id ? { ...b, ...partial } : b,
      );
      return { bands, slots: recomputeTimes(state.slots, state.settings, bands) };
    }),

  deleteBand: (id) =>
    set((state) => {
      const bands = state.bands.filter((b) => b.id !== id);
      const slots = state.slots.map((s) =>
        s.bandId === id ? { ...s, bandId: null } : s,
      );
      return { bands, slots: recomputeTimes(slots, state.settings, bands) };
    }),

  addSlot: () =>
    set((state) => {
      const slots = [
        ...state.slots,
        {
          id: crypto.randomUUID(),
          bandId: null,
          customLabel: null,
          customDurationMinutes: null,
          startTime: "",
          endTime: "",
        },
      ];
      return { slots: recomputeTimes(slots, state.settings, state.bands) };
    }),

  addCustomSlot: (label, durationMinutes) =>
    set((state) => {
      const slots = [
        ...state.slots,
        {
          id: crypto.randomUUID(),
          bandId: null,
          customLabel: label,
          customDurationMinutes: durationMinutes,
          startTime: "",
          endTime: "",
        },
      ];
      return { slots: recomputeTimes(slots, state.settings, state.bands) };
    }),

  updateSlot: (id, partial) =>
    set((state) => {
      const slots = state.slots.map((s) =>
        s.id === id ? { ...s, ...partial } : s,
      );
      return { slots: recomputeTimes(slots, state.settings, state.bands) };
    }),

  removeSlot: (id) =>
    set((state) => ({
      slots: recomputeTimes(
        state.slots.filter((s) => s.id !== id),
        state.settings,
        state.bands,
      ),
    })),

  assignBandToSlot: (bandId, slotId) =>
    set((state) => {
      const target = state.slots.find((s) => s.id === slotId);
      if (!target || target.customLabel !== null) return state;
      const slots = state.slots.map((s) => {
        if (s.id === slotId) return { ...s, bandId };
        if (s.bandId === bandId) return { ...s, bandId: null };
        return s;
      });
      return { slots: recomputeTimes(slots, state.settings, state.bands) };
    }),

  unassignSlot: (slotId) =>
    set((state) => {
      const slots = state.slots.map((s) =>
        s.id === slotId ? { ...s, bandId: null } : s,
      );
      return { slots: recomputeTimes(slots, state.settings, state.bands) };
    }),

  moveSlot: (id, direction) =>
    set((state) => {
      const idx = state.slots.findIndex((s) => s.id === id);
      if (idx < 0) return state;
      const swapWith = direction === "up" ? idx - 1 : idx + 1;
      if (swapWith < 0 || swapWith >= state.slots.length) return state;
      const slots = [...state.slots];
      [slots[idx], slots[swapWith]] = [slots[swapWith], slots[idx]];
      return { slots: recomputeTimes(slots, state.settings, state.bands) };
    }),

  reorderSlots: (activeId, overId) =>
    set((state) => {
      const oldIndex = state.slots.findIndex((s) => s.id === activeId);
      const newIndex = state.slots.findIndex((s) => s.id === overId);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return state;
      const slots = arrayMove(state.slots, oldIndex, newIndex);
      return { slots: recomputeTimes(slots, state.settings, state.bands) };
    }),

  updateSettings: (partial) =>
    set((state) => {
      const settings = { ...state.settings, ...partial };
      return { settings, slots: recomputeTimes(state.slots, settings, state.bands) };
    }),
}));

export function getMemberConflictSlotIds(
  slots: TimetableSlot[],
  bands: Band[],
): Set<string> {
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const conflicts = new Set<string>();

  for (let i = 0; i < slots.length - 1; i++) {
    const a = slots[i];
    const b = slots[i + 1];
    if (!a.bandId || !b.bandId) continue;
    const bandA = bandMap.get(a.bandId);
    const bandB = bandMap.get(b.bandId);
    if (!bandA || !bandB) continue;
    const shared = bandA.members.some((m) => bandB.members.includes(m));
    if (shared) {
      conflicts.add(a.id);
      conflicts.add(b.id);
    }
  }

  return conflicts;
}
