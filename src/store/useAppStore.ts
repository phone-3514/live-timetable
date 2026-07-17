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
  type VenueHours,
} from "../utils/parseBands";
import { minutesToTime, timeToMinutes } from "../utils/time";
import { normalizeMemberName } from "../utils/normalizeMemberName";
import { recomputeTimes } from "../utils/scheduleTimes";
import { canPlaceBandInSlot } from "../utils/scheduleEligibility";
import { solveDayAssignment } from "../utils/autoScheduleSolver";

// Re-exported so existing importers (e.g. SlotCard's drag-eligibility
// check) don't need to know this moved to a standalone utils module —
// canPlaceBandInSlot is pure and has no store dependency, but this is
// still its most natural "front door" for the rest of the app.
export { canPlaceBandInSlot };

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
  // Clipboard-driven bulk reorder: given a day and an ordered list of band
  // names (typically the user's own edited copy of what "コピー" produces —
  // pasted into a text editor, lines reordered, pasted back), permutes
  // which band occupies each of that day's already-band-carrying slot
  // positions to match. Names that don't resolve to a band currently on
  // this day are skipped; bands on the day but not mentioned keep their
  // relative order, appended after everything that WAS mentioned — nothing
  // gets silently dropped just because a line was left out.
  reorderDayBandsByNames: (dayId: string, orderedNames: string[]) => void;
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
          // memberDetails (grade/part) is a separate copy of the same
          // people (see PlacedBandDetailModal editing) — without updating
          // it here too, a rename via the Application Manager's name-
          // resolution merge would leave the Setlist export (which prefers
          // memberDetails when present) still showing the old spelling.
          memberDetails: b.memberDetails?.map((m) =>
            normalizeMemberName(m.name) === fromKey ? { ...m, name: toName } : m,
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

  reorderDayBandsByNames: (dayId, orderedNames) =>
    set((state) => {
      const day = state.days.find((d) => d.id === dayId);
      if (!day) return state;
      const bandMap = new Map(state.bands.map((b) => [b.id, b]));

      // Band ids currently placed on this day, in their current slot order.
      const remainingIds = day.slots
        .filter((s): s is TimetableSlot & { bandId: string } => s.bandId !== null)
        .map((s) => s.bandId);

      const newOrderIds: string[] = [];
      for (const rawName of orderedNames) {
        const name = rawName.trim();
        if (!name) continue;
        const idx = remainingIds.findIndex((id) => bandMap.get(id)?.name === name);
        if (idx === -1) continue;
        newOrderIds.push(remainingIds[idx]);
        remainingIds.splice(idx, 1);
      }
      // Anything on the day but not mentioned in the pasted text keeps its
      // relative order, appended after everything that WAS mentioned —
      // leaving a line out never silently drops a band from the day.
      newOrderIds.push(...remainingIds);
      if (newOrderIds.length === 0) return state;

      let cursor = 0;
      const days = state.days.map((d) => {
        if (d.id !== dayId) return d;
        const slots = d.slots.map((s) => {
          if (s.bandId === null) return s;
          const nextId = newOrderIds[cursor];
          cursor++;
          return { ...s, bandId: nextId };
        });
        return { ...d, slots: recomputeTimes(slots, d.settings, state.bands) };
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

  // Best-effort scheduler across ALL days at once. Two phases:
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
  // 2. Solve: for each day, hand its balanced target list to
  //    solveDayAssignment — a small CSP solver (simulated annealing over
  //    random swaps, bounded to a fixed iteration budget so this can't
  //    stall the UI) that searches for the ordering with the lowest total
  //    penalty across three constraints: a member double-booked back to
  //    back (heavy), a member's whole day concentrated in one block
  //    (medium), and the same artist appearing in two adjacent slots
  //    (medium). See utils/autoScheduleSolver for the scoring details.
  //
  // Bands with no eligible day, or that don't fit any slot's time window
  // on their assigned day even in the best arrangement the solver finds,
  // simply stay unplaced — this never forces a bad placement to hit a
  // perfectly even split.
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
        const dayPool = targetByDay.get(dayId) ?? [];
        if (dayPool.length === 0) continue;
        const currentDay = days.find((d) => d.id === dayId)!;
        const solvedSlots = solveDayAssignment(
          currentDay,
          dayPool,
          state.bands,
          state.venueHours,
        );
        days = days.map((d) => (d.id === dayId ? { ...d, slots: solvedSlots } : d));
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

// Member-conflict detection: a member is flagged when two of their OWN
// performances that day are either (a) too close together — gap <= the
// day's configured transition time between one performance's end and the
// next's start, which also naturally catches gap <= 0 (overlap/exactly
// back-to-back) since that's just the low end of the same range — or (b)
// the exact same band, regardless of the gap between them. (a) is
// deliberately scoped to the member's own chronologically-ADJACENT
// performances only (not "any two of their performances within N
// minutes"), so a large real gap elsewhere in the day never gets compared
// against a small one — being in two DIFFERENT bands that are scheduled
// back-to-back with nothing but the standard changeover between them is
// itself the problem being flagged (no time to strike one band's gear and
// set up/warm up for a completely different one), even though technically
// "enough" transition time exists on paper. (b) exists because a member's
// next performance being the identical band (not just a shared member)
// means either a duplicate placement or a genuine back-to-back set for the
// same act — worth flagging even across a longer-than-usual gap, since (a)
// alone would miss it. Deliberately separate from findGroupedConflicts
// above (which gear conflicts still use) because member scheduling and
// gear changeover aren't quite the same kind of "conflict," even though
// they now share the same threshold. Returns, per conflicting slot, which
// member(s) caused it and why, since "⚠ 前後の枠とメンバーが重複" without saying
// *who* (and *why*) leaves the organizer to go figure it out themselves.
// Only the EARLIER slot of each conflicting pair is included — a run of
// N consecutive conflicting performances lights up slots 1..N-1, not all
// N, since the last one has nothing after it to warn about.
export type MemberConflictReason = "gap" | "same-band";
export type MemberConflictEntry = { memberName: string; reason: MemberConflictReason };

export function getMemberConflictDetails(
  day: TimetableDay,
  bands: Band[],
): Map<string, MemberConflictEntry[]> {
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const byMember = new Map<
    string,
    {
      displayName: string;
      entries: { slotId: string; bandId: string; start: number; end: number }[];
    }
  >();

  for (const slot of day.slots) {
    if (!slot.bandId || !slot.startTime || !slot.endTime) continue;
    const band = bandMap.get(slot.bandId);
    if (!band) continue;
    const start = timeToMinutes(slot.startTime);
    const end = timeToMinutes(slot.endTime);
    const seenInThisSlot = new Set<string>();
    for (const rawName of band.members) {
      const key = normalizeMemberName(rawName);
      if (!key || seenInThisSlot.has(key)) continue;
      seenInThisSlot.add(key);
      const entry = byMember.get(key) ?? { displayName: rawName, entries: [] };
      entry.entries.push({ slotId: slot.id, bandId: band.id, start, end });
      byMember.set(key, entry);
    }
  }

  const conflictsBySlot = new Map<string, MemberConflictEntry[]>();
  for (const { displayName, entries } of byMember.values()) {
    entries.sort((a, b) => a.start - b.start);
    for (let i = 0; i < entries.length - 1; i++) {
      const a = entries[i];
      const b = entries[i + 1];
      const sameBand = a.bandId === b.bandId;
      const gap = b.start - a.end;
      if (sameBand || gap <= day.settings.transitionMinutes) {
        const reason: MemberConflictReason = sameBand ? "same-band" : "gap";
        // Only the EARLIER slot in a conflicting pair gets flagged, not
        // both — for a run of 3+ consecutive conflicting performances
        // (entries i, i+1, i+2, ...), each middle entry is "b" of one pair
        // and "a" of the next, so it still gets flagged via its OWN pair
        // with whatever comes after it; only the very last entry in the
        // chain (never an "a") ends up clear, since by then the warning
        // on the slot(s) before it already says everything there is to
        // say — a trailing "and this one too" on the last slot would just
        // be redundant.
        const list = conflictsBySlot.get(a.slotId) ?? [];
        if (!list.some((c) => c.memberName === displayName)) {
          list.push({ memberName: displayName, reason });
        }
        conflictsBySlot.set(a.slotId, list);
      }
    }
  }
  return conflictsBySlot;
}

// Splits a day into chronological "blocks" divided by its non-band slots
// (休憩・集合・リハーサルなど — anything with a customLabel, per addCustomSlot).
// Block 0 is everything before the first such slot, block 1 is everything
// between the first and second, and so on. Only band-performance slots get
// an entry — the dividers themselves aren't "in" a block, and neither is
// an empty not-yet-filled performance slot (customLabel === null but
// bandId === null too), since it isn't a performance yet. Used only by
// getConcentrationWarningDetails below; block index has no meaning outside
// that.
function computeSlotBlocks(day: TimetableDay): Map<string, number> {
  const blockBySlotId = new Map<string, number>();
  let block = 0;
  for (const slot of day.slots) {
    if (slot.customLabel !== null) {
      block++;
      continue;
    }
    if (slot.bandId) blockBySlotId.set(slot.id, block);
  }
  return blockBySlotId;
}

// "Performance concentration" warning: a member with 2+ performances that
// day, most or all of which land in the exact same block (see
// computeSlotBlocks), never gets a real break — they're either on stage or
// waiting right next to it for the entire stretch between breaks, unlike
// someone whose sets are spread across different blocks with a proper rest
// in between. This is a milder, advisory signal — not "these two
// performances literally conflict" (see getMemberConflictDetails) but
// "this person's day is (mostly) packed into one block" — so it's tracked
// independently, and a slot can show both warnings if it happens to
// trigger both.
//
// "Full" means every one of the member's performances that day falls in
// one block; "partial" means a strict majority (more than half) do, which
// is still worth surfacing but less severe. A block with only half or
// fewer of the member's slots isn't "concentration" — that's just a
// normal spread with one slightly busier stretch.
export type ConcentrationLevel = "full" | "partial";
export type ConcentrationEntry = {
  memberName: string;
  level: ConcentrationLevel;
  /** Total performances this member has on this day. */
  totalSlots: number;
  /** How many of those land in the single most-crowded block. */
  maxBlockSlots: number;
};

type ConcentrationStat = {
  displayName: string;
  totalSlots: number;
  maxBlockSlots: number;
  maxBlockSlotIds: string[];
  level: ConcentrationLevel;
};

// Shared by getConcentrationWarningDetails (per-slot, for SlotCard) and
// computeConcentrationSummary (per-day, for the Schedule Confirmation
// modal) so both surfaces agree on exactly the same numbers.
function computeDayConcentrationStats(
  day: TimetableDay,
  bands: Band[],
): Map<string, ConcentrationStat> {
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const blockBySlotId = computeSlotBlocks(day);
  const byMember = new Map<
    string,
    { displayName: string; slotsByBlock: Map<number, string[]> }
  >();

  for (const slot of day.slots) {
    if (!slot.bandId) continue;
    const band = bandMap.get(slot.bandId);
    if (!band) continue;
    const block = blockBySlotId.get(slot.id);
    if (block === undefined) continue;
    const seenInThisSlot = new Set<string>();
    for (const rawName of band.members) {
      const key = normalizeMemberName(rawName);
      if (!key || seenInThisSlot.has(key)) continue;
      seenInThisSlot.add(key);
      const entry =
        byMember.get(key) ?? { displayName: rawName, slotsByBlock: new Map() };
      const slotIds = entry.slotsByBlock.get(block) ?? [];
      slotIds.push(slot.id);
      entry.slotsByBlock.set(block, slotIds);
      byMember.set(key, entry);
    }
  }

  const stats = new Map<string, ConcentrationStat>();
  for (const [key, { displayName, slotsByBlock }] of byMember) {
    const totalSlots = [...slotsByBlock.values()].reduce(
      (sum, ids) => sum + ids.length,
      0,
    );
    if (totalSlots < 2) continue;
    let maxBlockSlotIds: string[] = [];
    for (const ids of slotsByBlock.values()) {
      if (ids.length > maxBlockSlotIds.length) maxBlockSlotIds = ids;
    }
    const maxBlockSlots = maxBlockSlotIds.length;
    if (maxBlockSlots < 2) continue;
    const ratio = maxBlockSlots / totalSlots;
    const level: ConcentrationLevel | null =
      ratio === 1 ? "full" : ratio > 0.5 ? "partial" : null;
    if (!level) continue;
    stats.set(key, { displayName, totalSlots, maxBlockSlots, maxBlockSlotIds, level });
  }
  return stats;
}

// Only the slots making up the crowded block get flagged (for a "full"
// case that's every slot the member has that day, since by definition
// they're all in the one block; for "partial" it's specifically the
// slots causing the concentration, not the ones outside it).
export function getConcentrationWarningDetails(
  day: TimetableDay,
  bands: Band[],
): Map<string, ConcentrationEntry[]> {
  const stats = computeDayConcentrationStats(day, bands);
  const warningsBySlot = new Map<string, ConcentrationEntry[]>();
  for (const { displayName, totalSlots, maxBlockSlots, maxBlockSlotIds, level } of stats.values()) {
    for (const slotId of maxBlockSlotIds) {
      const list = warningsBySlot.get(slotId) ?? [];
      list.push({ memberName: displayName, level, totalSlots, maxBlockSlots });
      warningsBySlot.set(slotId, list);
    }
  }
  return warningsBySlot;
}

export type ConcentrationSummaryEntry = {
  memberName: string;
  dayId: string;
  dayLabel: string;
  level: ConcentrationLevel;
  totalSlots: number;
  maxBlockSlots: number;
};

// Day-by-day summary for the Schedule Confirmation modal — concentration is
// inherently a per-day notion (blocks don't span days), so a member can
// show up once per day they're concentrated on, not once per event.
export function computeConcentrationSummary(
  days: TimetableDay[],
  bands: Band[],
): ConcentrationSummaryEntry[] {
  const result: ConcentrationSummaryEntry[] = [];
  for (const day of days) {
    const stats = computeDayConcentrationStats(day, bands);
    for (const { displayName, totalSlots, maxBlockSlots, level } of stats.values()) {
      result.push({
        memberName: displayName,
        dayId: day.id,
        dayLabel: day.label,
        level,
        totalSlots,
        maxBlockSlots,
      });
    }
  }
  // Full concentration is the more severe case — surface it first.
  return result.sort((a, b) => {
    if (a.level !== b.level) return a.level === "full" ? -1 : 1;
    return a.memberName.localeCompare(b.memberName, "ja");
  });
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
  /** Why hasAdjacentConflict is true — "same-band" takes priority over
   * "gap" when a member has conflicts of both kinds across their days,
   * since it's the more specific/severe case. null when there's no
   * conflict. */
  conflictReason: MemberConflictReason | null;
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
  const conflictDetailsByDay = new Map<string, Map<string, MemberConflictEntry[]>>();
  for (const day of days) {
    conflictDetailsByDay.set(day.id, getMemberConflictDetails(day, bands));
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
    // hasAdjacentConflict has to be computed before the size gate below,
    // not after: a member whose only band was placed into two slots (the
    // same-band-repeat rule in getMemberConflictDetails) has bandIds.size
    // === 1, but is still genuinely double-booked in time and needs to
    // show up here — the dashboard would otherwise silently miss exactly
    // the case a same-band repeat is meant to catch.
    let hasAdjacentConflict = false;
    let conflictReason: MemberConflictReason | null = null;
    for (const day of days) {
      const conflictMap = conflictDetailsByDay.get(day.id);
      if (!conflictMap) continue;
      for (const slot of day.slots) {
        if (!slot.bandId || !bandIds.has(slot.bandId)) continue;
        const match = conflictMap.get(slot.id)?.find((c) => c.memberName === displayName);
        if (match) {
          hasAdjacentConflict = true;
          if (conflictReason !== "same-band") conflictReason = match.reason;
        }
      }
    }

    if (bandIds.size < 2 && !hasAdjacentConflict) continue;

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

    schedules.push({
      name: displayName,
      entries,
      hasAdjacentConflict,
      conflictReason,
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
