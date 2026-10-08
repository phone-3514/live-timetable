import type { Band, TimetableSettings, TimetableSlot } from "../types";
import { recomputeTimes } from "./scheduleTimes";
import { minutesToTime, timeToMinutes } from "./time";

// What-if time arithmetic for planning a day's schedule *before* the real
// timetable exists (or while deciding how many bands a day can take): given a
// start time, per-band performance length, changeover time and any manual
// extras (休憩・準備・撤収…), when does the day end — and, the other way
// round, how many bands still fit before a deadline.
//
// Deliberately built on recomputeTimes (the exact function that stamps every
// real timetable slot's start/end) instead of re-deriving the arithmetic:
// the changeover only follows a *band*, never a break/gathering row, a band's
// own duration/changeover override the day default, and so on — a second
// implementation of those rules would silently drift from what the timetable
// actually shows. Synthetic slots/bands go in, recomputeTimes stamps them,
// and the "HH:MM" strings it returns are unwrapped back into absolute minutes
// so a day running past midnight reads as 25:10, not 01:10.

export type SimItem =
  | {
      kind: "band";
      label: string;
      /** null = use the day's default performance length. */
      minutes: number | null;
      /** Per-band changeover override, like Band.customTransitionMinutes. */
      transitionMinutes?: number;
    }
  | { kind: "extra"; label: string; minutes: number };

export type SimExtra = {
  id: string;
  label: string;
  minutes: number;
  /** before = ahead of the first band, after = behind the last one,
   * middle = right after the `afterBandCount`-th band. */
  position: "before" | "after" | "middle";
  afterBandCount: number;
};

export type SimRow = {
  key: string;
  kind: "band" | "extra";
  label: string;
  /** Absolute minutes from midnight of the first day; may exceed 1440. */
  start: number;
  end: number;
};

export type SimResult = {
  rows: SimRow[];
  bandCount: number;
  startMinutes: number;
  /** End of the last band (null if there are no bands). */
  lastBandEnd: number | null;
  /** End of the very last row, extras included (= startMinutes if empty). */
  finalEnd: number;
};

/** The standard pre/post-show flow the club always runs — same list as the
 * Timetable Editor's "開演前後の定型イベントを自動追加" button. */
export const STANDARD_SIM_EXTRAS: Omit<SimExtra, "id">[] = [
  { label: "幹部集合", minutes: 10, position: "before", afterBandCount: 0 },
  { label: "出演者集合", minutes: 5, position: "before", afterBandCount: 0 },
  { label: "リハーサル", minutes: 10, position: "before", afterBandCount: 0 },
  { label: "諸注意", minutes: 5, position: "before", afterBandCount: 0 },
  { label: "写真撮影", minutes: 5, position: "after", afterBandCount: 0 },
  { label: "完全撤収", minutes: 60, position: "after", afterBandCount: 0 },
];

// Lays the user's extras around/among the core items: "before" extras first,
// "after" extras last, and each "middle" extra immediately after the k-th
// band (k past the end lands after the last band, ahead of the "after"
// extras). Same-position extras keep the order they were listed in.
export function arrangeItems(core: SimItem[], extras: SimExtra[]): SimItem[] {
  const asItem = (e: SimExtra): SimItem => ({ kind: "extra", label: e.label, minutes: e.minutes });
  const before = extras.filter((e) => e.position === "before").map(asItem);
  const after = extras.filter((e) => e.position === "after").map(asItem);
  const middle = extras.filter((e) => e.position === "middle");
  const totalBands = core.filter((i) => i.kind === "band").length;

  const items: SimItem[] = [...before];
  let bandsSeen = 0;
  for (const item of core) {
    items.push(item);
    if (item.kind !== "band") continue;
    bandsSeen++;
    for (const e of middle) {
      if (Math.max(1, Math.min(e.afterBandCount, totalBands)) === bandsSeen) items.push(asItem(e));
    }
  }
  if (totalBands === 0) items.push(...middle.map(asItem));
  items.push(...after);
  return items;
}

function unwrap(minutes: number, floor: number): number {
  let value = minutes;
  while (value < floor) value += 1440;
  return value;
}

export function simulateItems(items: SimItem[], settings: TimetableSettings): SimResult {
  const bands: Band[] = [];
  const slots: TimetableSlot[] = [];
  items.forEach((item, i) => {
    if (item.kind === "band") {
      const id = `sim-band-${i}`;
      bands.push({
        id,
        name: item.label,
        members: [],
        setlist: [],
        desiredTime: "",
        ngTime: "",
        allowedDayIds: [],
        hasSync: false,
        hasKeyboard: false,
        gearTags: [],
        raw: "",
        durationMinutes: item.minutes ?? undefined,
        customTransitionMinutes: item.transitionMinutes,
      });
      slots.push({
        id: `sim-slot-${i}`,
        bandId: id,
        customLabel: null,
        customDurationMinutes: null,
        startTimeOverride: null,
        startTime: "",
        endTime: "",
      });
    } else {
      slots.push({
        id: `sim-slot-${i}`,
        bandId: null,
        customLabel: item.label,
        customDurationMinutes: item.minutes,
        startTimeOverride: null,
        startTime: "",
        endTime: "",
      });
    }
  });

  const computed = recomputeTimes(slots, settings, bands);
  const startMinutes = timeToMinutes(settings.startTime);
  let floor = startMinutes;
  const rows: SimRow[] = computed.map((slot, i) => {
    const start = unwrap(timeToMinutes(slot.startTime), floor);
    const end = unwrap(timeToMinutes(slot.endTime), start);
    floor = end;
    const item = items[i];
    return { key: slot.id, kind: item.kind, label: item.label, start, end };
  });

  const bandRows = rows.filter((r) => r.kind === "band");
  return {
    rows,
    bandCount: bandRows.length,
    startMinutes,
    lastBandEnd: bandRows.length > 0 ? bandRows[bandRows.length - 1].end : null,
    finalEnd: rows.length > 0 ? rows[rows.length - 1].end : startMinutes,
  };
}

export function simulateDay(core: SimItem[], extras: SimExtra[], settings: TimetableSettings): SimResult {
  return simulateItems(arrangeItems(core, extras), settings);
}

export type DeadlineBasis = "lastBand" | "final";

export function endOf(result: SimResult, basis: DeadlineBasis): number {
  return basis === "lastBand" ? (result.lastBandEnd ?? result.startMinutes) : result.finalEnd;
}

// A deadline earlier than the start is read as the next morning ("翌")
// rather than rejected, so a late-night finish like 00:30 just works.
export function resolveDeadline(deadline: string, startMinutes: number): number {
  return unwrap(timeToMinutes(deadline), startMinutes);
}

const MAX_SLOTS_SEARCH = 300;

/** Largest number of uniform bands (each the day's default performance
 * length) that still finish by `deadlineMinutes`, with `extras` laid out
 * exactly as simulateDay does. 0 means not even one band fits. */
export function maxBandsBeforeDeadline(
  extras: SimExtra[],
  settings: TimetableSettings,
  deadlineMinutes: number,
  basis: DeadlineBasis,
): number {
  let best = 0;
  for (let n = 1; n <= MAX_SLOTS_SEARCH; n++) {
    const core: SimItem[] = Array.from({ length: n }, (_, i) => ({
      kind: "band",
      label: `枠${i + 1}`,
      minutes: null,
    }));
    const result = simulateDay(core, extras, settings);
    if (endOf(result, basis) > deadlineMinutes) break;
    best = n;
  }
  return best;
}

/** How many default-length slots a band of `minutes` takes — a 20-minute
 * band counts as two 10-minute slots, per the application notice. Never
 * less than one. */
export function slotEquivalent(minutes: number, slotMinutes: number): number {
  if (slotMinutes <= 0) return 1;
  return Math.max(1, Math.ceil(minutes / slotMinutes));
}

/** Greedy balance: each band (in order) goes to whichever day currently has
 * the least load, mirroring the auto-scheduler's even-split goal without its
 * date/time restrictions. `initialLoads` seeds each day with its fixed
 * extras so a day already carrying 撤収 etc. gets proportionally fewer
 * bands. Returns the chosen day index per band. */
export function distributeAcrossDays(
  bandMinutes: number[],
  initialLoads: number[],
  transitionMinutes: number,
): number[] {
  const loads = [...initialLoads];
  return bandMinutes.map((minutes) => {
    let target = 0;
    for (let d = 1; d < loads.length; d++) {
      if (loads[d] < loads[target]) target = d;
    }
    loads[target] += minutes + transitionMinutes;
    return target;
  });
}

/** "10:05", or "翌0:30" once the day has run past midnight. */
export function formatClock(absoluteMinutes: number): string {
  const wrapped = minutesToTime(absoluteMinutes);
  return absoluteMinutes >= 1440 ? `翌${wrapped}` : wrapped;
}

/** "1時間30分" / "45分". */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}分`;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}
