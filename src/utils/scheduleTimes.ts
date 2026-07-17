import type { Band, TimetableSettings, TimetableSlot } from "../types";
import { minutesToTime, timeToMinutes } from "./time";

// A band's own durationMinutes (parsed from e.g. "演奏時間：10分") overrides
// the timetable's default performance duration for its slot. Custom rows
// (休憩・集合・リハーサル) use their own customDurationMinutes instead. The
// transition AFTER a slot only applies when that slot is an actual band
// performance — a transition exists to cover equipment strike/setup between
// bands, so a break/gathering/rehearsal row (or an empty unplaced slot)
// shouldn't add one after it. A band's transition falls back to the day's
// default unless it has its own customTransitionMinutes (e.g. a keyboard or
// sync-track band that needs longer to strike/set up gear).
//
// Pulled out of useAppStore so the auto-schedule CSP solver (a pure
// algorithm with no store dependencies) can recompute real start/end times
// for a candidate slot arrangement without importing from the store itself.
export function recomputeTimes(
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
