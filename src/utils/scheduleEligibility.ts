import type { Band, TimetableDay, TimetableSlot } from "../types";
import {
  DEFAULT_VENUE_HOURS,
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
