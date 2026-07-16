import { create } from "zustand";
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
  parseBands,
  type TimeRange,
  type VenueHours,
} from "../utils/parseBands";
import { minutesToTime, timeToMinutes } from "../utils/time";

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
  rawText: string;
  bands: Band[];
  days: TimetableDay[];
  venueHours: VenueHours;
  eventInfo: EventInfo;
  lastDeleted: DeletedBandSnapshot | null;

  setRawText: (text: string) => void;
  updateVenueHours: (partial: Partial<VenueHours>) => void;
  updateEventInfo: (partial: Partial<EventInfo>) => void;
  parseFromRawText: () => void;
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

export const useAppStore = create<AppState>((set) => ({
  rawText: "",
  bands: [],
  days: initialDays,
  venueHours: DEFAULT_VENUE_HOURS,
  eventInfo: { liveName: "", venue: "", organizationName: "" },
  lastDeleted: null,

  setRawText: (text) => set({ rawText: text }),
  updateVenueHours: (partial) =>
    set((state) => ({ venueHours: { ...state.venueHours, ...partial } })),
  updateEventInfo: (partial) =>
    set((state) => ({ eventInfo: { ...state.eventInfo, ...partial } })),

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
          const neighborMembers = new Set([
            ...(prevBand?.members ?? []),
            ...(nextBand?.members ?? []),
          ]);
          const nonConflicting = eligible.filter(
            (b) => !b.members.some((m) => neighborMembers.has(m)),
          );
          const chosen = (nonConflicting.length > 0 ? nonConflicting : eligible)[0];

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
}));

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
