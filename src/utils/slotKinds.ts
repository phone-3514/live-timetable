import type { TimetableSlot } from "../types";

/** A 余白 block: a time-taking row (customLabel set) that is hidden from the
 * generated timetable and is not a break (see TimetableSlot.hidden). */
export function isHiddenBlock(slot: Pick<TimetableSlot, "customLabel" | "hidden">): boolean {
  return slot.customLabel !== null && slot.hidden === true;
}

/** Index of the first slot after `index` that is not a 余白 block, or -1. */
export function nextVisibleIndex(slots: Pick<TimetableSlot, "customLabel" | "hidden">[], index: number): number {
  for (let i = index + 1; i < slots.length; i++) if (!isHiddenBlock(slots[i])) return i;
  return -1;
}
