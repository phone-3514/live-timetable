import { create } from "zustand";
import { persist } from "zustand/middleware";
import { arrayMove } from "@dnd-kit/sortable";
import type {
  Band,
  TimetableDay,
  TimetableSettings,
  TimetableSlot,
} from "../types";
import {
  DEFAULT_VENUE_HOURS,
  extractDayOfMonthHints,
  extractTimeRange,
  type TimeRange,
  type VenueHours,
} from "../utils/parseBands";
import { minutesToTime, timeToMinutes } from "../utils/time";
import { normalizeMemberName } from "../utils/normalizeMemberName";

// Snapshot kept for one undo step after deleteBand — restores both the
// band data and (if it was placed) the exact slot it occupied.
type DeletedBandSnapshot = {
  band: Band;
  placement: { dayId: string; slotId: string } | null;
};

// Event-wide (not per-day) details, shown on the share image — live name
// and venue in its header, organization name in its footer.
export type EventInfo = {
  liveName: string;
  venue: string;
  organizationName: string;
};

type AppState = {
  bands: Band[];
  days: TimetableDay[];
  venueHours: VenueHours;
  eventInfo: EventInfo;
  lastDeleted: DeletedBandSnapshot | null;

  updateVenueHours: (partial: Partial<VenueHours>) => void;
  updateEventInfo: (partial: Partial<EventInfo>) => void;
  // Appends bands rather than replacing the pool — used by the Application
  // Manager tab to push an approved band into the timetable's unplaced list
  // without disturbing anything already parsed/placed there.
  addBands: (bands: Band[]) => void;
  // Rewrites every occurrence of fromName (matched name-normalized, so it
  // catches every raw spelling variant already merged into that identity)
  // to toName across every band's member list — the Timetable Editor side
  // of the Name Resolution merge in the Application Manager, so a band
  // already approved before the merge doesn't keep showing the old
  // spelling. See useApplicationStore's mergeMemberName, which calls this.
  renameBandMember: (fromName: string, toName: string) => void;
  updateBand: (id: string, partial: Partial<Band>) => void;
  deleteBand: (id: string) => void;
  undoDeleteBand: () => void;
  clearLastDeleted: () => void;
  toggleBandDay: (bandId: string, dayId: string) => void;
  autoDetectDayRestrictions: () => void;

  addDay: () => void;
  removeDay: (dayId: string) => void;
  renameDay: (dayId: string, label: string) => void;
  updateDayDate: (dayId: string, date: string | null) => void;

  addSlot: (dayId: string) => void;
  addSlots: (dayId: string, count: number) => void;
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
  // "Magnetic" placement — dropping a band onto a slot that's already
  // filled doesn't replace what's there; it opens a new slot at that
  // position and pushes the existing occupant (and everyone after it that
  // day) later, the same way inserting a row does, rather than silently
  // orphaning whoever was there back to the unplaced pool.
  insertBandAtSlot: (bandId: string, targetSlotId: string) => void;
  // Multi-select bulk actions from BandListPanel — appends every given
  // band as a new slot at the end of the target day, in order. No
  // eligibility filtering (unlike autoScheduleAllDays): this is an
  // explicit, direct override of the user's own choosing, reversible via
  // the same undo/redo history as everything else.
  bulkAssignToDay: (bandIds: string[], dayId: string) => void;
  deleteBands: (bandIds: string[]) => void;
  unassignSlot: (slotId: string) => void;
  moveSlot: (dayId: string, slotId: string, direction: "up" | "down") => void;
  reorderSlots: (activeId: string, overId: string) => void;
  updateSettings: (dayId: string, partial: Partial<TimetableSettings>) => void;
  autoScheduleAllDays: () => void;
  resetAllPlacements: () => void;
  // Unlike resetAllPlacements (which only unassigns bands, keeping the
  // slots themselves), this deletes every slot on every day outright —
  // a full return to the empty-timetable state. Parsed bands are left
  // alone; they just end up back in the unplaced pool since nothing
  // references them anymore.
  clearAllSlots: () => void;
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

function makeBlankSlot(): TimetableSlot {
  return {
    id: crypto.randomUUID(),
    bandId: null,
    customLabel: null,
    customDurationMinutes: null,
    startTime: "",
    endTime: "",
  };
}

// A band's own durationMinutes (parsed from e.g. "演奏時間：10分") overrides
// the timetable's default performance duration for its slot. Custom rows
// (休憩・集合・リハーサル) use their own customDurationMinutes instead. The
// transition AFTER a slot only applies when that slot is an actual band
// performance — a transition exists to cover equipment strike/setup between
// bands, so a break/gathering/rehearsal row (or an empty unplaced slot)
// shouldn't add one after it. A band's transition falls back to the day's
// default unless it has its own customTransitionMinutes (e.g. a keyboard or
// sync-track band that needs longer to strike/set up gear).
function recomputeTimes(
  slots: TimetableSlot[],
  settings: TimetableSettings,
  bands: Band[],
): TimetableSlot[] {
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  let cursor = timeToMinutes(settings.startTime);
  return slots.map((slot) => {
    let duration = settings.performanceMinutes;
    let transitionAfter = 0;
    if (slot.bandId) {
      const band = bandMap.get(slot.bandId);
      duration = band?.durationMinutes ?? settings.performanceMinutes;
      transitionAfter = band?.customTransitionMinutes ?? settings.transitionMinutes;
    } else if (slot.customLabel !== null) {
      duration = slot.customDurationMinutes ?? settings.performanceMinutes;
    }
    const start = cursor;
    const end = start + duration;
    cursor = end + transitionAfter;
    return { ...slot, startTime: minutesToTime(start), endTime: minutesToTime(end) };
  });
}

// Live preview of the start time a dragged band would get if dropped at
// targetSlotId right now. Walks the day's slots the same way recomputeTimes
// does, but treats the dragged band's OWN current slot (if it has one in
// this day) as if it were already vacated — that slot reverts to an empty
// slot's default duration/transition (0 after it, per recomputeTimes), just
// like it will the instant the drop actually happens. Without this, moving
// a band whose durationMinutes differs from the day's default forward past
// its own old slot would show a stale, now-wrong time.
export function computeDropPreviewStartTime(
  day: TimetableDay,
  draggedBandId: string,
  targetSlotId: string,
  bands: Band[],
): string {
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  let cursor = timeToMinutes(day.settings.startTime);
  for (const slot of day.slots) {
    if (slot.id === targetSlotId) break;
    const effectiveBandId = slot.bandId === draggedBandId ? null : slot.bandId;
    let duration = day.settings.performanceMinutes;
    let transitionAfter = 0;
    if (effectiveBandId) {
      const band = bandMap.get(effectiveBandId);
      duration = band?.durationMinutes ?? day.settings.performanceMinutes;
      transitionAfter =
        band?.customTransitionMinutes ?? day.settings.transitionMinutes;
    } else if (slot.customLabel !== null) {
      duration = slot.customDurationMinutes ?? day.settings.performanceMinutes;
    }
    cursor += duration + transitionAfter;
  }
  return minutesToTime(cursor);
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

// A null bound in a TimeRange means "unbounded on that side" (e.g. "14時
//以降" has no end). Treating null as ±Infinity lets the same overlap check
// handle closed and open-ended ranges uniformly.
function slotOverlapsRange(
  slotStart: number,
  slotEnd: number,
  range: TimeRange,
): boolean {
  const rangeStart = range.startMinutes ?? -Infinity;
  const rangeEnd = range.endMinutes ?? Infinity;
  return slotStart < rangeEnd && rangeStart < slotEnd;
}

// Combined date + time-of-day eligibility check, used both to guard
// assignBandToSlot and to drive the "can't drop here" highlight while
// dragging. desiredTime constrains to an inclusion window; ngTime
// constrains to an exclusion window; allowedDayIds constrains which days.
export function canPlaceBandInSlot(
  band: Band,
  day: TimetableDay,
  slot: TimetableSlot,
  venue: VenueHours = DEFAULT_VENUE_HOURS,
): boolean {
  if (slot.customLabel !== null) return false;
  if (band.allowedDayIds.length > 0 && !band.allowedDayIds.includes(day.id)) {
    return false;
  }
  if (!slot.startTime || !slot.endTime) return true;
  const slotStart = timeToMinutes(slot.startTime);
  const slotEnd = timeToMinutes(slot.endTime);

  const ngRange = extractTimeRange(band.ngTime, venue);
  if (ngRange && slotOverlapsRange(slotStart, slotEnd, ngRange)) {
    return false;
  }

  const desiredRange = extractTimeRange(band.desiredTime, venue);
  if (desiredRange && !slotOverlapsRange(slotStart, slotEnd, desiredRange)) {
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

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
  bands: [],
  days: initialDays,
  venueHours: DEFAULT_VENUE_HOURS,
  eventInfo: { liveName: "", venue: "", organizationName: "" },
  lastDeleted: null,

  updateVenueHours: (partial) =>
    set((state) => ({ venueHours: { ...state.venueHours, ...partial } })),
  updateEventInfo: (partial) =>
    set((state) => ({ eventInfo: { ...state.eventInfo, ...partial } })),

  addBands: (newBands) =>
    set((state) => {
      // Only resolve day-hints for the newly added bands — re-running
      // autoResolveBandDays over the whole pool would also recompute
      // allowedDayIds for existing bands, silently discarding any manual
      // per-band day-toggle overrides already made on them.
      const resolvedNew = autoResolveBandDays(newBands, state.days);
      return { bands: [...state.bands, ...resolvedNew] };
    }),

  renameBandMember: (fromName, toName) =>
    set((state) => {
      const fromKey = normalizeMemberName(fromName);
      return {
        bands: state.bands.map((b) => ({
          ...b,
          members: b.members.map((m) =>
            normalizeMemberName(m) === fromKey ? toName : m,
          ),
        })),
      };
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
      const band = state.bands.find((b) => b.id === id);
      if (!band) return state;

      let placement: { dayId: string; slotId: string } | null = null;
      const bands = state.bands.filter((b) => b.id !== id);
      const days = state.days.map((day) => {
        const slot = day.slots.find((s) => s.bandId === id);
        if (slot) placement = { dayId: day.id, slotId: slot.id };
        const slots = day.slots.map((s) =>
          s.bandId === id ? { ...s, bandId: null } : s,
        );
        return { ...day, slots: recomputeTimes(slots, day.settings, bands) };
      });
      return { bands, days, lastDeleted: { band, placement } };
    }),

  undoDeleteBand: () =>
    set((state) => {
      if (!state.lastDeleted) return state;
      const { band, placement } = state.lastDeleted;
      const bands = [...state.bands, band];
      const days = state.days.map((day) => {
        if (!placement || day.id !== placement.dayId) {
          return { ...day, slots: recomputeTimes(day.slots, day.settings, bands) };
        }
        const slots = day.slots.map((s) =>
          s.id === placement.slotId ? { ...s, bandId: band.id } : s,
        );
        return { ...day, slots: recomputeTimes(slots, day.settings, bands) };
      });
      return { bands, days, lastDeleted: null };
    }),

  clearLastDeleted: () => set({ lastDeleted: null }),

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
      return { days: [...state.days, day] };
    }),

  removeDay: (dayId) =>
    set((state) => {
      if (state.days.length <= 1) return state;
      return { days: state.days.filter((d) => d.id !== dayId) };
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

  addSlot: (dayId) =>
    set((state) => ({
      days: updateDaySlots(state.days, dayId, state.bands, (slots) => [
        ...slots,
        makeBlankSlot(),
      ]),
    })),

  addSlots: (dayId, count) =>
    set((state) => ({
      days: updateDaySlots(state.days, dayId, state.bands, (slots) => [
        ...slots,
        ...Array.from({ length: Math.max(0, count) }, () => makeBlankSlot()),
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
        !canPlaceBandInSlot(band, targetDay, targetSlot, state.venueHours)
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

  insertBandAtSlot: (bandId, targetSlotId) =>
    set((state) => {
      const targetDay = state.days.find((d) =>
        d.slots.some((s) => s.id === targetSlotId),
      );
      const targetSlot = targetDay?.slots.find((s) => s.id === targetSlotId);
      const band = state.bands.find((b) => b.id === bandId);
      if (
        !targetDay ||
        !targetSlot ||
        !band ||
        !canPlaceBandInSlot(band, targetDay, targetSlot, state.venueHours)
      ) {
        return state;
      }
      const newSlot: TimetableSlot = {
        id: crypto.randomUUID(),
        bandId,
        customLabel: null,
        customDurationMinutes: null,
        startTime: "",
        endTime: "",
      };
      const days = state.days.map((day) => {
        // Vacate wherever this band currently sits first — same as
        // assignBandToSlot, a band being moved leaves its old slot empty
        // rather than deleting it. Since this only nulls bandId in place
        // (never removes a slot), the target index computed below stays
        // valid regardless of whether the old placement was on this same
        // day before or after the insertion point.
        let slots = day.slots.map((s) =>
          s.bandId === bandId ? { ...s, bandId: null } : s,
        );
        if (day.id === targetDay.id) {
          const idx = slots.findIndex((s) => s.id === targetSlotId);
          slots = [...slots.slice(0, idx), newSlot, ...slots.slice(idx)];
        }
        return { ...day, slots: recomputeTimes(slots, day.settings, state.bands) };
      });
      return { days };
    }),

  bulkAssignToDay: (bandIds, dayId) =>
    set((state) => {
      const idSet = new Set(bandIds);
      const newSlots: TimetableSlot[] = bandIds.map((bandId) => ({
        id: crypto.randomUUID(),
        bandId,
        customLabel: null,
        customDurationMinutes: null,
        startTime: "",
        endTime: "",
      }));
      const days = state.days.map((day) => {
        let slots = day.slots.map((s) =>
          s.bandId && idSet.has(s.bandId) ? { ...s, bandId: null } : s,
        );
        if (day.id === dayId) {
          slots = [...slots, ...newSlots];
        }
        return { ...day, slots: recomputeTimes(slots, day.settings, state.bands) };
      });
      return { days };
    }),

  deleteBands: (bandIds) =>
    set((state) => {
      const idSet = new Set(bandIds);
      const bands = state.bands.filter((b) => !idSet.has(b.id));
      const days = state.days.map((day) => {
        const slots = day.slots.map((s) =>
          s.bandId && idSet.has(s.bandId) ? { ...s, bandId: null } : s,
        );
        return { ...day, slots: recomputeTimes(slots, day.settings, bands) };
      });
      return { bands, days };
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

  // Greedy best-effort scheduler across ALL days at once. Two phases:
  //
  // 1. Balance: split the unplaced pool across days so each ends up with
  //    as close to an equal band count as possible, without violating a
  //    hard date restriction — a band greedily joins whichever of its
  //    eligible days currently has the smaller running total (which
  //    starts from that day's already-filled slot count, so pre-existing
  //    manual placements count toward the balance too). Each day's empty
  //    performance-slot count is then topped up or trimmed to match its
  //    target, per the request to add/remove slots automatically.
  //
  // 2. Fill: same per-day greedy fill as before (eligibility +
  //    neighbor-conflict avoidance), run once per day using only that
  //    day's balanced target list. Re-reads each slot's time fresh every
  //    iteration since an earlier assignment's duration can cascade and
  //    shift later slots.
  //
  // Bands with no eligible day, or that don't fit any slot's time window
  // on their assigned day, simply stay unplaced — this never forces a bad
  // placement to hit a perfectly even split.
  autoScheduleAllDays: () =>
    set((state) => {
      if (state.days.length === 0) return state;
      const placedElsewhere = getPlacedBandIds(state.days);
      const pool = state.bands.filter((b) => !placedElsewhere.has(b.id));
      if (pool.length === 0) return state;

      const dayIds = state.days.map((d) => d.id);
      const targetByDay = new Map<string, Band[]>(dayIds.map((id) => [id, []]));
      const runningTotal = new Map<string, number>(
        state.days.map((d) => [
          d.id,
          d.slots.filter((s) => s.bandId !== null).length,
        ]),
      );

      for (const band of pool) {
        const eligibleDayIds =
          band.allowedDayIds.length > 0
            ? dayIds.filter((id) => band.allowedDayIds.includes(id))
            : dayIds;
        if (eligibleDayIds.length === 0) continue;
        let best = eligibleDayIds[0];
        for (const id of eligibleDayIds) {
          if ((runningTotal.get(id) ?? 0) < (runningTotal.get(best) ?? 0)) {
            best = id;
          }
        }
        targetByDay.get(best)!.push(band);
        runningTotal.set(best, (runningTotal.get(best) ?? 0) + 1);
      }

      let days = state.days;
      for (const day of state.days) {
        const target = targetByDay.get(day.id) ?? [];
        const emptySlotCount = day.slots.filter(
          (s) => s.bandId === null && s.customLabel === null,
        ).length;
        const diff = target.length - emptySlotCount;
        if (diff > 0) {
          days = updateDaySlots(days, day.id, state.bands, (slots) => [
            ...slots,
            ...Array.from({ length: diff }, () => makeBlankSlot()),
          ]);
        } else if (diff < 0) {
          let toRemove = -diff;
          days = updateDaySlots(days, day.id, state.bands, (slots) =>
            slots.filter((s) => {
              if (toRemove > 0 && s.bandId === null && s.customLabel === null) {
                toRemove--;
                return false;
              }
              return true;
            }),
          );
        }
      }

      for (const dayId of dayIds) {
        let dayPool = targetByDay.get(dayId) ?? [];
        const slotCount = days.find((d) => d.id === dayId)!.slots.length;
        for (let i = 0; i < slotCount; i++) {
          const currentDay = days.find((d) => d.id === dayId)!;
          const slot = currentDay.slots[i];
          if (slot.bandId !== null || slot.customLabel !== null) continue;

          const eligible = dayPool.filter((b) =>
            canPlaceBandInSlot(b, currentDay, slot, state.venueHours),
          );
          if (eligible.length === 0) continue;

          const prevBand = bandInSlot(currentDay.slots[i - 1], state.bands);
          const nextBand = bandInSlot(currentDay.slots[i + 1], state.bands);
          const neighborMembers = new Set(
            [...(prevBand?.members ?? []), ...(nextBand?.members ?? [])].map(
              normalizeMemberName,
            ),
          );
          const neighborGearTags = new Set([
            ...(prevBand?.gearTags ?? []),
            ...(nextBand?.gearTags ?? []),
          ]);
          const memberClean = eligible.filter(
            (b) => !b.members.some((m) => neighborMembers.has(normalizeMemberName(m))),
          );
          // Prefer a candidate that's clean on both counts; fall back to
          // "at least no member overlap" (the more serious problem — a
          // person literally can't be in two places) before finally
          // accepting whatever's left rather than leaving the slot empty.
          const fullyClean = memberClean.filter(
            (b) => !b.gearTags.some((t) => neighborGearTags.has(t)),
          );
          const chosen = (fullyClean.length > 0 ? fullyClean : memberClean.length > 0 ? memberClean : eligible)[0];

          days = days.map((d) => {
            const slots = d.slots.map((s) => {
              if (d.id === dayId && s.id === slot.id) return { ...s, bandId: chosen.id };
              if (s.bandId === chosen.id) return { ...s, bandId: null };
              return s;
            });
            return { ...d, slots: recomputeTimes(slots, d.settings, state.bands) };
          });
          dayPool = dayPool.filter((b) => b.id !== chosen.id);
        }
      }

      return { days };
    }),

  resetAllPlacements: () =>
    set((state) => ({
      days: state.days.map((day) => {
        const slots = day.slots.map((s) =>
          s.bandId !== null ? { ...s, bandId: null } : s,
        );
        return { ...day, slots: recomputeTimes(slots, day.settings, state.bands) };
      }),
    })),

  clearAllSlots: () =>
    set((state) => ({
      days: state.days.map((day) => ({ ...day, slots: [] })),
    })),
    }),
    {
      name: "live-timetable-app",
      // Pre-existing localStorage data predates the gearTags field (added
      // for the gear-conflict checker) — every band saved before that
      // shipped is missing it entirely. Without this backfill,
      // getGearConflictSlotIds/computeGearConflictDetails crash the whole
      // app on load (`gearTags.length` on undefined) the instant two of a
      // user's existing bands land in adjacent slots, which is the normal
      // case for anyone who's actually used this app, not an edge case.
      // merge (unlike migrate) runs on every rehydration regardless of
      // version, so this protects data already sitting in someone's
      // browser right now, not just newly-created bands going forward.
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<AppState>) ?? {};
        const bands = persisted.bands ?? currentState.bands;
        return {
          ...currentState,
          ...persisted,
          bands: bands.map((b) => ({ ...b, gearTags: b.gearTags ?? [] })),
        };
      },
    },
  ),
);

function bandInSlot(
  slot: TimetableSlot | undefined,
  bands: Band[],
): Band | undefined {
  if (!slot?.bandId) return undefined;
  return bands.find((b) => b.id === slot.bandId);
}

export function getPlacedBandIds(days: TimetableDay[]): Set<string> {
  const ids = new Set<string>();
  for (const day of days) {
    for (const slot of day.slots) {
      if (slot.bandId) ids.add(slot.bandId);
    }
  }
  return ids;
}

// Groups every slot in a day that's keyed by some grouping value (a
// member's normalized name, a gear tag) into per-key chronological lists,
// then flags a pair within the same group as a conflict when the real gap
// between them (in minutes) is at or below the day's own baseline
// transition time. This — not literal array-index adjacency — is what
// getMemberConflictSlotIds and getGearConflictSlotIds both need: being
// *next to each other in the slots array* is not a reliable proxy for
// *close together in time*. Unplaced/empty slots and a band's own
// customTransitionMinutes override can each push real hours between two
// slots that still happen to sit at consecutive array indices — the
// concrete bug this fixes was a band with a large customTransitionMinutes
// making its literal next slot register as "conflicting" with a member 5
// hours later, even though there was ample time between them. Grouping by
// actual start time and comparing against the day's own configured
// transitionMinutes (the organizer's own definition of "a normal
// changeover") catches genuinely tight back-to-back scheduling while
// correctly ignoring gaps that just happen to be array-adjacent.
function findGroupedConflicts<T>(
  day: TimetableDay,
  bands: Band[],
  keysFor: (band: Band) => T[],
): Map<T, string[]> {
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const byKey = new Map<T, { slotId: string; start: number; end: number }[]>();

  for (const slot of day.slots) {
    if (!slot.bandId || !slot.startTime || !slot.endTime) continue;
    const band = bandMap.get(slot.bandId);
    if (!band) continue;
    const start = timeToMinutes(slot.startTime);
    const end = timeToMinutes(slot.endTime);
    for (const key of keysFor(band)) {
      const list = byKey.get(key) ?? [];
      list.push({ slotId: slot.id, start, end });
      byKey.set(key, list);
    }
  }

  const threshold = day.settings.transitionMinutes;
  const conflictsByKey = new Map<T, string[]>();
  for (const [key, entries] of byKey) {
    entries.sort((a, b) => a.start - b.start);
    for (let i = 0; i < entries.length - 1; i++) {
      const gap = entries[i + 1].start - entries[i].end;
      if (gap <= threshold) {
        const pair = conflictsByKey.get(key) ?? [];
        pair.push(entries[i].slotId, entries[i + 1].slotId);
        conflictsByKey.set(key, pair);
      }
    }
  }
  return conflictsByKey;
}

export function getMemberConflictSlotIds(day: TimetableDay, bands: Band[]): Set<string> {
  const byMember = findGroupedConflicts(day, bands, (band) => [
    ...new Set(band.members.map(normalizeMemberName).filter(Boolean)),
  ]);
  return new Set([...byMember.values()].flat());
}

// Same idea as getMemberConflictSlotIds above, but for shared physical gear
// (see Band.gearTags) instead of shared members — two bands tagged with the
// same piece of equipment close together means someone has to physically
// move it across the stage in whatever transition time is actually
// available, which is exactly the kind of thing that's easy to miss
// scanning a long timetable but obvious once flagged.
export function getGearConflictSlotIds(day: TimetableDay, bands: Band[]): Set<string> {
  const byTag = findGroupedConflicts(day, bands, (band) => band.gearTags);
  return new Set([...byTag.values()].flat());
}

export type GearConflictDetail = {
  dayLabel: string;
  bandAName: string;
  bandBName: string;
  sharedTags: string[];
  transitionMinutes: number;
};

// Rich version of getGearConflictSlotIds for the schedule-review dashboard
// (ScheduleReviewModal) — that inline highlight only needs "is this slot
// involved," the dashboard needs to say *which* bands, *which* tag, and how
// much transition time they're actually getting so the organizer can judge
// whether it's enough without having to go find the slot on the grid.
export function computeGearConflictDetails(
  days: TimetableDay[],
  bands: Band[],
): GearConflictDetail[] {
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const details: GearConflictDetail[] = [];

  for (const day of days) {
    const threshold = day.settings.transitionMinutes;
    const byTag = new Map<string, { bandName: string; start: number; end: number }[]>();

    for (const slot of day.slots) {
      if (!slot.bandId || !slot.startTime || !slot.endTime) continue;
      const band = bandMap.get(slot.bandId);
      if (!band || band.gearTags.length === 0) continue;
      const start = timeToMinutes(slot.startTime);
      const end = timeToMinutes(slot.endTime);
      for (const tag of band.gearTags) {
        const list = byTag.get(tag) ?? [];
        list.push({ bandName: band.name, start, end });
        byTag.set(tag, list);
      }
    }

    for (const [tag, entries] of byTag) {
      entries.sort((a, b) => a.start - b.start);
      for (let i = 0; i < entries.length - 1; i++) {
        const gap = entries[i + 1].start - entries[i].end;
        if (gap > threshold) continue;
        details.push({
          dayLabel: day.label,
          bandAName: entries[i].bandName,
          bandBName: entries[i + 1].bandName,
          sharedTags: [tag],
          transitionMinutes: Math.max(0, gap),
        });
      }
    }
  }

  return details;
}

export type MemberScheduleEntry = {
  bandId: string;
  bandName: string;
  dayLabel: string;
  startTime: string;
  endTime: string;
};

export type MemberSchedule = {
  name: string;
  entries: MemberScheduleEntry[];
  hasAdjacentConflict: boolean;
  unplacedCount: number;
};

// One row per member who's in 2+ bands, each with every band they're in and
// where (if anywhere) it landed on the grid — the standalone view for "who's
// actually overloaded today" that getMemberConflictSlotIds' per-slot inline
// highlight doesn't give you, since that only surfaces one conflict at a
// time as you scroll past it. Meant for a final review pass right before
// placement gets locked in, not for continuous display.
export function computeMemberSchedules(
  bands: Band[],
  days: TimetableDay[],
): MemberSchedule[] {
  const byMember = new Map<string, { displayName: string; bandIds: Set<string> }>();
  for (const band of bands) {
    const seenInThisBand = new Set<string>();
    for (const rawName of band.members) {
      const key = normalizeMemberName(rawName);
      if (!key || seenInThisBand.has(key)) continue;
      seenInThisBand.add(key);
      const entry = byMember.get(key) ?? { displayName: rawName, bandIds: new Set() };
      entry.bandIds.add(band.id);
      byMember.set(key, entry);
    }
  }

  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const placementByBandId = new Map<
    string,
    { dayLabel: string; startTime: string; endTime: string }
  >();
  const conflictSlotIdsByDay = new Map<string, Set<string>>();
  for (const day of days) {
    conflictSlotIdsByDay.set(day.id, getMemberConflictSlotIds(day, bands));
    for (const slot of day.slots) {
      if (slot.bandId) {
        placementByBandId.set(slot.bandId, {
          dayLabel: day.label,
          startTime: slot.startTime,
          endTime: slot.endTime,
        });
      }
    }
  }

  const schedules: MemberSchedule[] = [];
  for (const { displayName, bandIds } of byMember.values()) {
    if (bandIds.size < 2) continue;

    const entries: MemberScheduleEntry[] = [...bandIds]
      .map((bandId) => {
        const band = bandMap.get(bandId)!;
        const placement = placementByBandId.get(bandId);
        return {
          bandId,
          bandName: band.name,
          dayLabel: placement?.dayLabel ?? "",
          startTime: placement?.startTime ?? "",
          endTime: placement?.endTime ?? "",
        };
      })
      .sort((a, b) => `${a.dayLabel}${a.startTime}`.localeCompare(`${b.dayLabel}${b.startTime}`));

    let hasAdjacentConflict = false;
    for (const day of days) {
      const conflictSlotIds = conflictSlotIdsByDay.get(day.id);
      if (!conflictSlotIds) continue;
      for (const slot of day.slots) {
        if (slot.bandId && bandIds.has(slot.bandId) && conflictSlotIds.has(slot.id)) {
          hasAdjacentConflict = true;
        }
      }
    }

    schedules.push({
      name: displayName,
      entries,
      hasAdjacentConflict,
      unplacedCount: entries.filter((e) => !e.startTime).length,
    });
  }

  return schedules.sort((a, b) => {
    if (a.hasAdjacentConflict !== b.hasAdjacentConflict) {
      return a.hasAdjacentConflict ? -1 : 1;
    }
    return b.entries.length - a.entries.length;
  });
}

// Total distinct-band count per member across the *whole* band pool
// (placed and unplaced alike) — the Timetable Editor's own equivalent of
// the Application Manager's computeMemberFrameCounts, kept separate since
// this operates on Band.members directly rather than Application records
// and the two tabs don't share a data model.
export function computeBandMemberFrameCounts(bands: Band[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const band of bands) {
    const uniqueInBand = new Set(band.members.map(normalizeMemberName).filter(Boolean));
    for (const key of uniqueInBand) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

const HIGH_PARTICIPATION_THRESHOLD = 3;

// How many of this band's members are individually "high participation"
// (3+ bands across the whole event) — the per-slot signal the timeline
// heatmap renders as intensity. A slot's own heat doesn't depend on its
// neighbors; the visual effect of "this block of the day is a busy zone"
// comes from several high-heat slots sitting next to each other, not from
// any cross-slot computation here.
export function computeSlotHeatLevel(
  band: Band | undefined,
  frameCounts: Map<string, number>,
): number {
  if (!band) return 0;
  const uniqueMembers = new Set(band.members.map(normalizeMemberName).filter(Boolean));
  let level = 0;
  for (const m of uniqueMembers) {
    if ((frameCounts.get(m) ?? 0) >= HIGH_PARTICIPATION_THRESHOLD) level++;
  }
  return level;
}
