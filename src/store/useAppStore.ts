import { create } from "zustand";
import { arrayMove } from "@dnd-kit/sortable";
import type {
  Band,
  TimetableDay,
  TimetableSettings,
  TimetableSlot,
} from "../types";
import {
  extractDayOfMonthHints,
  extractTimeRange,
  parseBands,
} from "../utils/parseBands";
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
  toggleBandDay: (bandId: string, dayId: string) => void;
  autoDetectDayRestrictions: () => void;

  addDay: () => void;
  removeDay: (dayId: string) => void;
  renameDay: (dayId: string, label: string) => void;
  updateDayDate: (dayId: string, date: string | null) => void;
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
  return {
    id: crypto.randomUUID(),
    label,
    date: null,
    settings: defaultSettings(),
    slots: [],
  };
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

function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// Combined date + time-of-day eligibility check, used both to guard
// assignBandToSlot and to drive the "can't drop here" highlight while
// dragging. desiredTime constrains to an inclusion window; ngTime
// constrains to an exclusion window; allowedDayIds constrains which days.
export function canPlaceBandInSlot(
  band: Band,
  day: TimetableDay,
  slot: TimetableSlot,
): boolean {
  if (slot.customLabel !== null) return false;
  if (band.allowedDayIds.length > 0 && !band.allowedDayIds.includes(day.id)) {
    return false;
  }
  if (!slot.startTime || !slot.endTime) return true;
  const slotStart = timeToMinutes(slot.startTime);
  const slotEnd = timeToMinutes(slot.endTime);

  const ngRange = extractTimeRange(band.ngTime);
  if (
    ngRange &&
    rangesOverlap(slotStart, slotEnd, ngRange.startMinutes, ngRange.endMinutes)
  ) {
    return false;
  }

  const desiredRange = extractTimeRange(band.desiredTime);
  if (
    desiredRange &&
    !rangesOverlap(slotStart, slotEnd, desiredRange.startMinutes, desiredRange.endMinutes)
  ) {
    return false;
  }

  return true;
}

// Resolves a band's desiredTime/ngTime day-of-month hints ("13日") into
// actual day ids by matching against each TimetableDay's calendar date.
// Returns [] (unrestricted) when hints or day dates aren't available.
export function resolveAllowedDayIds(band: Band, days: TimetableDay[]): string[] {
  const dayNumberToIds = new Map<number, string[]>();
  for (const day of days) {
    if (!day.date) continue;
    const dom = new Date(`${day.date}T00:00:00`).getDate();
    const ids = dayNumberToIds.get(dom) ?? [];
    ids.push(day.id);
    dayNumberToIds.set(dom, ids);
  }
  if (dayNumberToIds.size === 0) return [];

  const desiredDates = extractDayOfMonthHints(band.desiredTime);
  const ngDates = extractDayOfMonthHints(band.ngTime);

  let allowed: Set<string> | null = null;
  if (desiredDates.length > 0) {
    allowed = new Set();
    for (const d of desiredDates) {
      for (const id of dayNumberToIds.get(d) ?? []) allowed.add(id);
    }
  }
  if (ngDates.length > 0) {
    const disallowed = new Set<string>();
    for (const d of ngDates) {
      for (const id of dayNumberToIds.get(d) ?? []) disallowed.add(id);
    }
    if (allowed) {
      for (const id of disallowed) allowed.delete(id);
    } else {
      allowed = new Set(days.map((d) => d.id));
      for (const id of disallowed) allowed.delete(id);
    }
  }
  if (!allowed) return [];
  return [...allowed];
}

function autoResolveBandDays(bands: Band[], days: TimetableDay[]): Band[] {
  return bands.map((b) => ({ ...b, allowedDayIds: resolveAllowedDayIds(b, days) }));
}

// After (re-)resolving allowedDayIds, any band already placed on a day it's
// no longer eligible for must be unassigned so the board never shows an
// invalid state.
function clearDisallowedPlacements(
  days: TimetableDay[],
  bands: Band[],
): TimetableDay[] {
  return days.map((day) => {
    const slots = day.slots.map((s) => {
      if (!s.bandId) return s;
      const band = bands.find((b) => b.id === s.bandId);
      if (!band) return s;
      const isAllowed =
        band.allowedDayIds.length === 0 || band.allowedDayIds.includes(day.id);
      return isAllowed ? s : { ...s, bandId: null };
    });
    return { ...day, slots: recomputeTimes(slots, day.settings, bands) };
  });
}

const initialDays = [makeDay("1日目"), makeDay("2日目")];

export const useAppStore = create<AppState>((set) => ({
  rawText: "",
  bands: [],
  days: initialDays,
  activeDayId: initialDays[0].id,

  setRawText: (text) => set({ rawText: text }),

  parseFromRawText: () =>
    set((state) => {
      const parsed = parseBands(state.rawText);
      const bands = autoResolveBandDays(parsed, state.days);
      return { bands };
    }),

  updateBand: (id, partial) =>
    set((state) => {
      // Editing desiredTime/ngTime changes the day-of-month hints those
      // fields encode, so the resolved day restriction is refreshed
      // automatically — no manual "re-detect" step needed.
      const touchesDateHints = "desiredTime" in partial || "ngTime" in partial;
      const bands = state.bands.map((b) => {
        if (b.id !== id) return b;
        const next = { ...b, ...partial };
        if (touchesDateHints) {
          next.allowedDayIds = resolveAllowedDayIds(next, state.days);
        }
        return next;
      });
      const days = touchesDateHints
        ? clearDisallowedPlacements(state.days, bands)
        : state.days.map((day) => ({
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

  toggleBandDay: (bandId, dayId) =>
    set((state) => {
      const allDayIds = state.days.map((d) => d.id);
      const bands = state.bands.map((b) => {
        if (b.id !== bandId) return b;
        const current = b.allowedDayIds.length > 0 ? b.allowedDayIds : allDayIds;
        const next = current.includes(dayId)
          ? current.filter((id) => id !== dayId)
          : [...current, dayId];
        const allowedDayIds = next.length >= allDayIds.length ? [] : next;
        return { ...b, allowedDayIds };
      });

      // If a band becomes disallowed on the day it's currently placed on,
      // clear that placement so the board never shows an invalid state.
      const band = bands.find((b) => b.id === bandId)!;
      const days = state.days.map((day) => {
        const isNowAllowed =
          band.allowedDayIds.length === 0 || band.allowedDayIds.includes(day.id);
        if (isNowAllowed) return day;
        if (!day.slots.some((s) => s.bandId === bandId)) return day;
        const slots = day.slots.map((s) =>
          s.bandId === bandId ? { ...s, bandId: null } : s,
        );
        return { ...day, slots: recomputeTimes(slots, day.settings, bands) };
      });

      return { bands, days };
    }),

  // Manual re-sync: recomputes every band's allowedDayIds from its current
  // desiredTime/ngTime text (discarding any manual day-toggle overrides).
  // Not needed in the normal flow — parsing, editing desired/NG time, and
  // setting a day's date all auto-resolve already — but useful after bulk
  // edits or to reset overrides back to what the text implies.
  autoDetectDayRestrictions: () =>
    set((state) => {
      const bands = autoResolveBandDays(state.bands, state.days);
      const days = clearDisallowedPlacements(state.days, bands);
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

  updateDayDate: (dayId, date) =>
    set((state) => {
      const days = state.days.map((d) => (d.id === dayId ? { ...d, date } : d));
      const bands = autoResolveBandDays(state.bands, days);
      return { bands, days: clearDisallowedPlacements(days, bands) };
    }),

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
      const band = state.bands.find((b) => b.id === bandId);
      if (
        !targetDay ||
        !targetSlot ||
        !band ||
        !canPlaceBandInSlot(band, targetDay, targetSlot)
      ) {
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
