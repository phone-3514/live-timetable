import type { TimetableSlot } from "../types";

/** A 余白 block: a time-taking row (customLabel set) that is hidden from the
 * generated timetable and is not a break (see TimetableSlot.hidden). */
export function isHiddenBlock(slot: Pick<TimetableSlot, "customLabel" | "hidden">): boolean {
  return slot.customLabel !== null && slot.hidden === true;
}
