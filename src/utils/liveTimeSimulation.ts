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
  | {
      kind: "extra";
      label: string;
      minutes: number;
      hidden?: boolean;
      /** 利用者が追加項目(SimExtra)として入れた行。バンドとバンドの間に入るときだけ、
       * 規定の転換時間を下回らないよう長さを補正する(applyChangeoverToExtras)。
       * 実際のタイムテーブルの行をそのまま写した行には付けない(実物と同じ時刻にするため)。 */
      planned?: boolean;
      /** 補正で足した分(分)。タイムラインに「転換◯分を含む」と出すため。 */
      addedChangeover?: number;
    };

export type SimExtra = {
  id: string;
  label: string;
  minutes: number;
  /** before = ahead of the first band, after = behind the last one,
   * middle = right after the `afterBandCount`-th band. */
  position: "before" | "after" | "middle";
  afterBandCount: number;
  /** A 余白 block: takes time like any extra, but is left out of the timetable
   * image / copied list / pamphlet once applied to the real timetable. */
  hidden?: boolean;
};

export type SimRow = {
  key: string;
  kind: "band" | "extra";
  /** A 余白 block (see SimExtra.hidden). */
  hidden?: boolean;
  label: string;
  /** Absolute minutes from midnight of the first day; may exceed 1440. */
  start: number;
  end: number;
  /** 規定の転換時間を保つために、この行へ足した分(分)。 */
  addedChangeover?: number;
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
  const asItem = (e: SimExtra): SimItem => ({ kind: "extra", label: e.label, minutes: e.minutes, hidden: e.hidden, planned: true });
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
        ...(item.hidden ? { hidden: true } : {}),
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
    return {
      key: slot.id,
      kind: item.kind,
      label: item.label,
      start,
      end,
      ...(item.kind === "extra" && item.hidden ? { hidden: true } : {}),
      ...(item.kind === "extra" && item.addedChangeover ? { addedChangeover: item.addedChangeover } : {}),
    };
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

/** バンドとバンドの間に入れた追加項目の並び(run)が、規定の転換時間 `changeover` を下回らない
 * ように、どの行にいくら足すかを返す(足りていれば null)。
 *  - 表示される項目(休憩・準備など)がある: 転換はその間に済ませるものとして、合計が転換より
 *    短いときだけ転換時間まで切り上げる(休憩5分・転換10分 → 10分、休憩20分 → 20分のまま)。
 *  - 余白(非表示)だけ: 余白は「転換に上乗せする余裕」なので、転換時間を足す(余白5分・転換10分 → 15分)。
 *  - 両方ある: 表示される項目で転換を満たし、余白はその上に上乗せになる。
 * 余白・休憩の行には転換時間が付かない(recomputeTimes)ため、そのままだと間隔が項目の長さだけに
 * なり、規定の転換より短くなる。 */
export function changeoverShortfall(
  run: { minutes: number; hidden?: boolean }[],
  changeover: number,
): { index: number; add: number } | null {
  if (run.length === 0 || changeover <= 0) return null;
  const visibleIndex = run.findIndex((e) => !e.hidden);
  if (visibleIndex === -1) return { index: 0, add: changeover };
  const visibleTotal = run.reduce((sum, e) => (e.hidden ? sum : sum + e.minutes), 0);
  const add = changeover - visibleTotal;
  return add > 0 ? { index: visibleIndex, add } : null;
}

/** 利用者の追加項目(planned)がバンドとバンドの間に挟まる所だけ、転換時間を保つよう補正する。 */
export function applyChangeoverToExtras(items: SimItem[], defaultChangeover: number): SimItem[] {
  const out = [...items];
  for (let i = 0; i < out.length; i++) {
    const band = out[i];
    if (band.kind !== "band") continue;
    let j = i + 1;
    while (j < out.length && out[j].kind === "extra") j++;
    // i の次から j の手前までが、バンド同士の間の追加項目。次もバンドで、間が全部 planned のときだけ。
    if (j >= out.length || j === i + 1 || out[j].kind !== "band") continue;
    const run = out.slice(i + 1, j) as Extract<SimItem, { kind: "extra" }>[];
    if (!run.every((e) => e.planned)) continue;
    const shortfall = changeoverShortfall(run, band.transitionMinutes ?? defaultChangeover);
    if (!shortfall) continue;
    const target = run[shortfall.index];
    out[i + 1 + shortfall.index] = {
      ...target,
      minutes: target.minutes + shortfall.add,
      addedChangeover: (target.addedChangeover ?? 0) + shortfall.add,
    };
  }
  return out;
}

export function simulateDay(core: SimItem[], extras: SimExtra[], settings: TimetableSettings): SimResult {
  return simulateItems(applyChangeoverToExtras(arrangeItems(core, extras), settings.transitionMinutes), settings);
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
 * bands.
 *
 * `limits` (optional) is each day's room for bands in slot units — what fits
 * before that day's 締切, null = no deadline, unlimited — alongside `bandUnits`,
 * how many units each band takes. A band only goes to a day it still fits in
 * (balanced among those); once every day is full the rest spill onto the day
 * they overflow least. So with deadlines set, the split follows what fits
 * rather than evening out the days' finishing times.
 * Returns the chosen day index per band. */
export function distributeAcrossDays(
  bandMinutes: number[],
  initialLoads: number[],
  transitionMinutes: number,
  limits?: { bandUnits: number[]; dayLimits: (number | null)[] },
): number[] {
  const loads = [...initialLoads];
  const used = initialLoads.map(() => 0);
  return bandMinutes.map((minutes, i) => {
    const units = limits?.bandUnits[i] ?? 1;
    const overflow = (d: number) => {
      const limit = limits?.dayLimits[d] ?? null;
      return limit === null ? 0 : Math.max(0, used[d] + units - limit);
    };
    const fits = loads.map((_, d) => d).filter((d) => overflow(d) === 0);
    const pool = fits.length > 0 ? fits : loads.map((_, d) => d);
    let target = pool[0];
    for (const d of pool) {
      const better =
        fits.length > 0
          ? loads[d] < loads[target]
          : overflow(d) < overflow(target) || (overflow(d) === overflow(target) && loads[d] < loads[target]);
      if (better) target = d;
    }
    loads[target] += minutes + transitionMinutes;
    used[target] += units;
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
  // 秒は切り捨て(4.5分 → 「4分」)。整数の分のときは従来どおり。
  const total = Math.max(0, Math.floor(Math.round(minutes * 60) / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}分`;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}
