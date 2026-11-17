import type { Band, TimetableDay, TimetableSettings, TimetableSlot } from "../types";
import { changeoverShortfall, type SimExtra } from "./liveTimeSimulation";
import { makeBlankSlot, makeCustomEventSlot } from "./slotFactories";

// Turns what the time simulator worked out into edits of a real day. Three
// independent parts, any of which can be skipped (null):
//   - settings: the day's start time / performance length / changeover
//   - slotCount: how many performance slots (empty or holding a band) the
//     day should have
//   - extras: the 休憩・準備・撤収 rows, placed where the simulator placed them
// Pure (takes the day, returns slots) so the same function drives both the
// live "this is what will change" preview and the real apply.

export type SimulationPlan = {
  dayId: string;
  settings: TimetableSettings | null;
  slotCount: number | null;
  extras: SimExtra[] | null;
  /** Remove the day's existing non-performance rows before inserting
   * `extras` (otherwise they're kept and the extras are added to them). */
  replaceCustomSlots: boolean;
};

export type PlannedDay = {
  slots: TimetableSlot[];
  addedSlots: number;
  /** Empty slots dropped because the day had more than slotCount. */
  removedSlots: number;
  /** Surplus slots that couldn't be dropped because they hold a band. */
  keptSurplus: number;
  insertedExtras: number;
  removedCustom: number;
};

// `bands` (optional): lets a band's own 転換時間の個別設定 count when keeping the
// changeover between two bands that an extra is inserted between.
export function planDaySlots(day: TimetableDay, plan: SimulationPlan, bands: Band[] = []): PlannedDay {
  let slots = day.slots;
  let removedCustom = 0;

  if (plan.extras !== null && plan.replaceCustomSlots) {
    const kept = slots.filter((s) => s.customLabel === null);
    removedCustom = slots.length - kept.length;
    slots = kept;
  }

  let addedSlots = 0;
  let removedSlots = 0;
  let keptSurplus = 0;
  if (plan.slotCount !== null) {
    const target = Math.max(0, plan.slotCount);
    const performanceCount = slots.filter((s) => s.customLabel === null).length;
    if (performanceCount < target) {
      const blanks = Array.from({ length: target - performanceCount }, () => makeBlankSlot());
      // Right after the last performance slot, so trailing rows such as 撤収
      // stay at the end of the day.
      let lastPerformance = -1;
      slots.forEach((s, i) => {
        if (s.customLabel === null) lastPerformance = i;
      });
      slots =
        lastPerformance === -1
          ? [...slots, ...blanks]
          : [...slots.slice(0, lastPerformance + 1), ...blanks, ...slots.slice(lastPerformance + 1)];
      addedSlots = blanks.length;
    } else if (performanceCount > target) {
      // Only ever drop *empty* slots, from the end — a slot already holding a
      // band is the organizer's work and is never removed by a simulation.
      const next = [...slots];
      let toRemove = performanceCount - target;
      for (let i = next.length - 1; i >= 0 && toRemove > 0; i--) {
        if (next[i].customLabel === null && next[i].bandId === null) {
          next.splice(i, 1);
          toRemove--;
          removedSlots++;
        }
      }
      keptSurplus = toRemove;
      slots = next;
    }
  }

  let insertedExtras = 0;
  if (plan.extras !== null) {
    const asSlot = (e: SimExtra) => makeCustomEventSlot(e.label, e.minutes, e.hidden === true);
    const before = plan.extras.filter((e) => e.position === "before").map(asSlot);
    const after = plan.extras.filter((e) => e.position === "after").map(asSlot);
    const middle = plan.extras.filter((e) => e.position === "middle");
    const performanceTotal = slots.filter((s) => s.customLabel === null).length;

    const settings = plan.settings ? { ...day.settings, ...plan.settings } : day.settings;
    const bandById = new Map(bands.map((b) => [b.id, b]));

    const next: TimetableSlot[] = [...before];
    let seen = 0;
    for (let index = 0; index < slots.length; index++) {
      const slot = slots[index];
      next.push(slot);
      if (slot.customLabel !== null) continue;
      seen++;
      // "after the k-th band", with k past the end landing after the last.
      const group = middle.filter((e) => Math.max(1, Math.min(e.afterBandCount, performanceTotal)) === seen);
      if (group.length === 0) continue;
      const minutes = group.map((e) => e.minutes);
      // 余白・休憩の行には転換時間が付かないので、次もバンドの枠のときは、規定の転換時間を
      // 下回らないよう長さを補正する(シミュレーターの計算と同じ規則)。
      const following = slots[index + 1];
      if (following && following.customLabel === null) {
        const band = slot.bandId ? bandById.get(slot.bandId) : undefined;
        const shortfall = changeoverShortfall(group, band?.customTransitionMinutes ?? settings.transitionMinutes);
        if (shortfall) minutes[shortfall.index] += shortfall.add;
      }
      group.forEach((e, i) => next.push(makeCustomEventSlot(e.label, minutes[i], e.hidden === true)));
    }
    if (performanceTotal === 0) next.push(...middle.map(asSlot));
    next.push(...after);
    insertedExtras = plan.extras.length;
    slots = next;
  }

  return { slots, addedSlots, removedSlots, keptSurplus, insertedExtras, removedCustom };
}
