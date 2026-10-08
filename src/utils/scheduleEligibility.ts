import type { Band, TimetableDay, TimetableSlot } from "../types";
import {
  DEFAULT_VENUE_HOURS,
  extractDayClauses,
  extractTimeRange,
  type TimeRange,
  type VenueHours,
} from "./parseBands";
import { timeToMinutes } from "./time";

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

// The time window a free-text 出演希望日 / NG時間 sets for ONE day. When the
// text names dates ("17日、18日17:30以降", "17日16:00まで、18日18:30〜") each
// date's own clause is read separately — a time written after a date belongs to
// that date, and a date with no time next to it ("17日、") is open all day — so
// pulling a single range out of the whole string and applying it to every day
// would wrongly hold 17日 to 18日's 17:30. The day's calendar date is needed to
// know which clause is its; with no date on the day, or no clause naming it
// (the day restriction itself is allowedDayIds' job), it falls back to the one
// range read from the whole text, as before.
//
// `hasClauses` tells the caller whether per-day reading applied, because for NG
// time a text that names only other dates must not exclude this day at all.
function timeRangeForDay(
  text: string,
  day: TimetableDay,
  venue: VenueHours,
): { range: TimeRange | null; matchedDay: boolean; namesDates: boolean } {
  const clauses = extractDayClauses(text);
  if (clauses.length > 0 && day.date) {
    const dayOfMonth = Number(day.date.slice(8, 10));
    const clause = clauses.find((c) => c.day === dayOfMonth);
    if (clause) {
      return { range: extractTimeRange(clause.clause, venue), matchedDay: true, namesDates: true };
    }
    return { range: extractTimeRange(text, venue), matchedDay: false, namesDates: true };
  }
  return { range: extractTimeRange(text, venue), matchedDay: false, namesDates: clauses.length > 0 };
}

// Combined date + time-of-day eligibility check, used to guard
// assignBandToSlot, drive the "can't drop here" highlight while dragging,
// and (as a heavy soft-constraint proxy) score candidate arrangements in
// the auto-schedule CSP solver. desiredTime constrains to an inclusion
// window; ngTime constrains to an exclusion window; allowedDayIds
// constrains which days. Pulled out of useAppStore so the solver (a pure
// algorithm with no store dependency) can reuse the exact same rule
// without importing from the store itself.
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

  const ng = timeRangeForDay(band.ngTime, day, venue);
  // An NG time that names only other dates doesn't apply to this day.
  const ngApplies = !(ng.namesDates && day.date && !ng.matchedDay);
  if (ngApplies && ng.range && slotOverlapsRange(slotStart, slotEnd, ng.range)) {
    return false;
  }

  const { range: desiredRange } = timeRangeForDay(band.desiredTime, day, venue);
  if (desiredRange && !slotOverlapsRange(slotStart, slotEnd, desiredRange)) {
    return false;
  }

  return true;
}
