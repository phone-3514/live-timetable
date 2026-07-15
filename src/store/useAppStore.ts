import { create } from "zustand";
import { arrayMove } from "@dnd-kit/sortable";
import type {
  Band,
  TimetableDay,
  TimetableSettings,
  TimetableSlot,
} from "../types";
import { parseBands } from "../utils/parseBands";
import { minutesToTime, timeToMinutes } from "../utils/time";

type AppState = {
  rawText: string;
  bands: Band[];
  days: TimetableDay[];
  activeDayId: string;

  setRawText: (text: string) => void;
  parseFromRawText: () => void;
  updateBand: (id: string, partial: Partial<Band>) => void;
  deleteBand: (id: string) => void;

  addDay: () => void;
  removeDay: (dayId: string) => void;
  renameDay: (dayId: string, label: string) => void;
  setActiveDay: (dayId: string) => void;

  addSlot: (dayId: string) => void;
  addCustomSlot: (dayId: string, label: string, durationMinutes: number) => void;
  updateSlotContent: (
    dayId: string,
    slotId: string,
    partial: Partial<Pick<TimetableSlot, "customLabel" | "customDurationMinutes">>,
  ) => void;
  removeSlot: (dayId: string, slotId: string) => void;
  // Band assignment/unassignment/reordering look up which day a slot
  // belongs to internally, since slot ids are globally unique — this lets
  // a band be dragged directly from one day's timetable into another's.
  assignBandToSlot: (bandId: string, slotId: string) => void;
  unassignSlot: (slotId: string) => void;
  moveSlot: (dayId: string, slotId: string, direction: "up" | "down") => void;
  reorderSlots: (activeId: string, overId: string) => void;
  updateSettings: (dayId: string, partial: Partial<TimetableSettings>) => void;
};

function defaultSettings(): TimetableSettings {
  return { startTime: "10:00", performanceMinutes: 20, transitionMinutes: 15 };
}

function makeDay(label: string): TimetableDay {
  return { id: crypto.randomUUID(), label, settings: defaultSettings(), slots: [] };
}

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

function updateDaySlots(
  days: TimetableDay[],
  dayId: string,
  bands: Band[],
  updater: (slots: TimetableSlot[]) => TimetableSlot[],
): TimetableDay[] {
  return days.map((day) => {
    if (day.id !== dayId) return day;
    const slots = recomputeTimes(updater(day.slots), day.settings, bands);
    return { ...day, slots };
  });
}

const initialDays = [makeDay("1日目"), makeDay("2日目")];

export const useAppStore = create<AppState>((set, get) => ({
  rawText: "",
  bands: [],
  days: initialDays,
  activeDayId: initialDays[0].id,

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
      const days = state.days.map((day) => ({
        ...day,
        slots: recomputeTimes(day.slots, day.settings, bands),
      }));
      return { bands, days };
    }),

  deleteBand: (id) =>
    set((state) => {
      const bands = state.bands.filter((b) => b.id !== id);
      const days = state.days.map((day) => {
        const slots = day.slots.map((s) =>
          s.bandId === id ? { ...s, bandId: null } : s,
        );
        return { ...day, slots: recomputeTimes(slots, day.settings, bands) };
      });
      return { bands, days };
    }),

  addDay: () =>
    set((state) => {
      const day = makeDay(`${state.days.length + 1}日目`);
      return { days: [...state.days, day], activeDayId: day.id };
    }),

  removeDay: (dayId) =>
    set((state) => {
      if (state.days.length <= 1) return state;
      const days = state.days.filter((d) => d.id !== dayId);
      const activeDayId =
        state.activeDayId === dayId ? days[0].id : state.activeDayId;
      return { days, activeDayId };
    }),

  renameDay: (dayId, label) =>
    set((state) => ({
      days: state.days.map((d) => (d.id === dayId ? { ...d, label } : d)),
    })),

  setActiveDay: (dayId) => set({ activeDayId: dayId }),

  addSlot: (dayId) =>
    set((state) => ({
      days: updateDaySlots(state.days, dayId, state.bands, (slots) => [
        ...slots,
        {
          id: crypto.randomUUID(),
          bandId: null,
          customLabel: null,
          customDurationMinutes: null,
          startTime: "",
          endTime: "",
        },
      ]),
    })),

  addCustomSlot: (dayId, label, durationMinutes) =>
    set((state) => ({
      days: updateDaySlots(state.days, dayId, state.bands, (slots) => [
        ...slots,
        {
          id: crypto.randomUUID(),
          bandId: null,
          customLabel: label,
          customDurationMinutes: durationMinutes,
          startTime: "",
          endTime: "",
        },
      ]),
    })),

  updateSlotContent: (dayId, slotId, partial) =>
    set((state) => ({
      days: updateDaySlots(state.days, dayId, state.bands, (slots) =>
        slots.map((s) => (s.id === slotId ? { ...s, ...partial } : s)),
      ),
    })),

  removeSlot: (dayId, slotId) =>
    set((state) => ({
      days: updateDaySlots(state.days, dayId, state.bands, (slots) =>
        slots.filter((s) => s.id !== slotId),
      ),
    })),

  assignBandToSlot: (bandId, slotId) =>
    set((state) => {
      const targetDay = state.days.find((d) =>
        d.slots.some((s) => s.id === slotId),
      );
      const targetSlot = targetDay?.slots.find((s) => s.id === slotId);
      if (!targetDay || !targetSlot || targetSlot.customLabel !== null) {
        return state;
      }
      const days = state.days.map((day) => {
        const slots = day.slots.map((s) => {
          if (day.id === targetDay.id && s.id === slotId) {
            return { ...s, bandId };
          }
          if (s.bandId === bandId) return { ...s, bandId: null };
          return s;
        });
        return { ...day, slots: recomputeTimes(slots, day.settings, state.bands) };
      });
      return { days };
    }),

  unassignSlot: (slotId) =>
    set((state) => {
      const days = state.days.map((day) => {
        if (!day.slots.some((s) => s.id === slotId)) return day;
        const slots = day.slots.map((s) =>
          s.id === slotId ? { ...s, bandId: null } : s,
        );
        return { ...day, slots: recomputeTimes(slots, day.settings, state.bands) };
      });
      return { days };
    }),

  moveSlot: (dayId, slotId, direction) =>
    set((state) => ({
      days: updateDaySlots(state.days, dayId, state.bands, (slots) => {
        const idx = slots.findIndex((s) => s.id === slotId);
        if (idx < 0) return slots;
        const swapWith = direction === "up" ? idx - 1 : idx + 1;
        if (swapWith < 0 || swapWith >= slots.length) return slots;
        const next = [...slots];
        [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
        return next;
      }),
    })),

  reorderSlots: (activeId, overId) =>
    set((state) => {
      const day = state.days.find((d) =>
        d.slots.some((s) => s.id === activeId),
      );
      if (!day) return state;
      const oldIndex = day.slots.findIndex((s) => s.id === activeId);
      const newIndex = day.slots.findIndex((s) => s.id === overId);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return state;
      return {
        days: updateDaySlots(state.days, day.id, state.bands, (slots) =>
          arrayMove(slots, oldIndex, newIndex),
        ),
      };
    }),

  updateSettings: (dayId, partial) =>
    set((state) => ({
      days: state.days.map((day) => {
        if (day.id !== dayId) return day;
        const settings = { ...day.settings, ...partial };
        return { ...day, settings, slots: recomputeTimes(day.slots, settings, state.bands) };
      }),
    })),
}));

export function getPlacedBandIds(days: TimetableDay[]): Set<string> {
  const ids = new Set<string>();
  for (const day of days) {
    for (const slot of day.slots) {
      if (slot.bandId) ids.add(slot.bandId);
    }
  }
  return ids;
}

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
