import type { TimetableSlot } from "../types";

// An empty performance slot — no band yet, not a break/gathering row.
export function makeBlankSlot(): TimetableSlot {
  return {
    id: crypto.randomUUID(),
    bandId: null,
    customLabel: null,
    customDurationMinutes: null,
    startTimeOverride: null,
    delayMinutes: 0,
    startTime: "",
    endTime: "",
  };
}

// A non-performance row (休憩・集合・リハーサル・撤収…) with its own length.
export function makeCustomEventSlot(label: string, durationMinutes: number): TimetableSlot {
  return {
    id: crypto.randomUUID(),
    bandId: null,
    customLabel: label,
    customDurationMinutes: durationMinutes,
    startTimeOverride: null,
    delayMinutes: 0,
    startTime: "",
    endTime: "",
  };
}
