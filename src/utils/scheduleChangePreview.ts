import type { Band, TimetableDay, TimetableSlot } from "../types";
import { recomputeTimes } from "./scheduleTimes";
import { minutesToTime, timeToMinutes } from "./time";

export type TimeChange = { label: string; before: string; after: string };
export type ScheduleChangePreview = {
  affectedMembers: string[];
  timeChanges: TimeChange[];
  newConsecutivePerformances: string[];
  previousEndTime: string;
  nextEndTime: string;
};

function adjacentConflicts(day: TimetableDay, bands: Band[]): Set<string> {
  const bandMap = new Map(bands.map((band) => [band.id, band]));
  const result = new Set<string>();
  for (let index = 1; index < day.slots.length; index++) {
    const previous = day.slots[index - 1];
    const current = day.slots[index];
    const a = previous.bandId ? bandMap.get(previous.bandId) : null;
    const b = current.bandId ? bandMap.get(current.bandId) : null;
    if (!a || !b) continue;
    const bMembers = new Set(b.members.map((member) => member.trim().toLowerCase()));
    for (const member of a.members) {
      if (bMembers.has(member.trim().toLowerCase())) result.add(`${member}（${a.name} → ${b.name}）`);
    }
  }
  return result;
}

export function previewScheduleAdjustment(
  day: TimetableDay,
  bands: Band[],
  slotId: string,
  deltaMinutes: number | null,
): { nextDay: TimetableDay; preview: ScheduleChangePreview } | null {
  const index = day.slots.findIndex((slot) => slot.id === slotId);
  if (index < 0) return null;
  let slots: TimetableSlot[];
  if (deltaMinutes === null) {
    const baseline = recomputeTimes(
      day.slots.map((slot) => ({ ...slot, startTimeOverride: null })),
      day.settings,
      bands,
    );
    slots = day.slots.map((slot, slotIndex) =>
      slotIndex < index ? slot : { ...slot, startTimeOverride: baseline[slotIndex].startTime },
    );
  } else {
    slots = day.slots.map((slot, slotIndex) =>
      slotIndex < index
        ? slot
        : { ...slot, startTimeOverride: minutesToTime(timeToMinutes(slot.startTime) + deltaMinutes) },
    );
  }
  const nextDay = { ...day, slots: recomputeTimes(slots, day.settings, bands) };
  const bandMap = new Map(bands.map((band) => [band.id, band]));
  const affectedMembers = new Set<string>();
  const timeChanges: TimeChange[] = [];
  day.slots.forEach((slot, slotIndex) => {
    const next = nextDay.slots[slotIndex];
    if (!next || (slot.startTime === next.startTime && slot.endTime === next.endTime)) return;
    const band = slot.bandId ? bandMap.get(slot.bandId) : null;
    band?.members.forEach((member) => affectedMembers.add(member));
    timeChanges.push({
      label: band?.name ?? slot.customLabel ?? "空き枠",
      before: `${slot.startTime}〜${slot.endTime}`,
      after: `${next.startTime}〜${next.endTime}`,
    });
  });
  const beforeConflicts = adjacentConflicts(day, bands);
  const newConsecutivePerformances = [...adjacentConflicts(nextDay, bands)].filter(
    (conflict) => !beforeConflicts.has(conflict),
  );
  return {
    nextDay,
    preview: {
      affectedMembers: [...affectedMembers],
      timeChanges,
      newConsecutivePerformances,
      previousEndTime: day.slots.at(-1)?.endTime ?? "--:--",
      nextEndTime: nextDay.slots.at(-1)?.endTime ?? "--:--",
    },
  };
}

export function previewSlotReorder(
  day: TimetableDay,
  bands: Band[],
  activeSlotId: string,
  overSlotId: string,
): ScheduleChangePreview | null {
  const from = day.slots.findIndex((slot) => slot.id === activeSlotId);
  const to = day.slots.findIndex((slot) => slot.id === overSlotId);
  if (from < 0 || to < 0 || from === to) return null;
  const reordered = [...day.slots];
  const [moved] = reordered.splice(from, 1);
  reordered.splice(to, 0, moved);
  const nextDay = { ...day, slots: recomputeTimes(reordered, day.settings, bands) };
  const beforeConflicts = adjacentConflicts(day, bands);
  const bandMap = new Map(bands.map((band) => [band.id, band]));
  const affectedMembers = new Set<string>();
  const beforeById = new Map(day.slots.map((slot) => [slot.id, slot]));
  const timeChanges: TimeChange[] = [];
  for (const slot of nextDay.slots) {
    const before = beforeById.get(slot.id);
    if (!before || (before.startTime === slot.startTime && before.endTime === slot.endTime)) continue;
    const band = slot.bandId ? bandMap.get(slot.bandId) : null;
    band?.members.forEach((member) => affectedMembers.add(member));
    timeChanges.push({ label: band?.name ?? slot.customLabel ?? "空き枠", before: `${before.startTime}〜${before.endTime}`, after: `${slot.startTime}〜${slot.endTime}` });
  }
  return {
    affectedMembers: [...affectedMembers],
    timeChanges,
    newConsecutivePerformances: [...adjacentConflicts(nextDay, bands)].filter((conflict) => !beforeConflicts.has(conflict)),
    previousEndTime: day.slots.at(-1)?.endTime ?? "--:--",
    nextEndTime: nextDay.slots.at(-1)?.endTime ?? "--:--",
  };
}
