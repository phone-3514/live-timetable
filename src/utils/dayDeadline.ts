import type { TimetableDay, TimetableSettings, TimetableSlot } from "../types";
import { alignTimeToReference } from "./scheduleTimes";
import { timeToMinutes } from "./time";

// A day's 締切 (set from the time simulator, editable on the day): the show
// must not end later than this. Ending earlier is fine. "lastBand" measures to
// the end of the last band's set; "final" to the end of the day's last row
// (撤収などの追加項目まで含めた終了).
export type DeadlineBasis = "lastBand" | "final";

/** The deadline as absolute minutes on the day's own clock — one earlier than
 * the start reads as the next morning ("翌"). null when none is set. */
export function deadlineAbsoluteMinutes(settings: TimetableSettings): number | null {
  if (!settings.deadline) return null;
  const start = timeToMinutes(settings.startTime);
  let deadline = timeToMinutes(settings.deadline);
  while (deadline < start) deadline += 24 * 60;
  return deadline;
}

/** Absolute end of the day by `basis`, from the slots' own start/end times
 * (null when no band is placed / there are no timed slots). */
export function dayEndAbsoluteMinutes(
  slots: TimetableSlot[],
  settings: TimetableSettings,
  basis: DeadlineBasis,
): number | null {
  let reference = timeToMinutes(settings.startTime);
  let lastBandEnd: number | null = null;
  let lastEnd: number | null = null;
  for (const slot of slots) {
    if (!slot.startTime || !slot.endTime) continue;
    const start = alignTimeToReference(slot.startTime, reference);
    const end = alignTimeToReference(slot.endTime, start);
    reference = end;
    lastEnd = end;
    if (slot.bandId) lastBandEnd = end;
  }
  return basis === "final" ? lastEnd : lastBandEnd;
}

export type DeadlineStatus = {
  deadline: number;
  end: number;
  /** Minutes past the deadline (0 when within it). */
  overBy: number;
};

export function getDeadlineStatus(day: Pick<TimetableDay, "settings" | "slots">): DeadlineStatus | null {
  const deadline = deadlineAbsoluteMinutes(day.settings);
  if (deadline === null) return null;
  const end = dayEndAbsoluteMinutes(day.slots, day.settings, day.settings.deadlineBasis ?? "lastBand");
  if (end === null) return null;
  return { deadline, end, overBy: Math.max(0, end - deadline) };
}
