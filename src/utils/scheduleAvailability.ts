import {
  DEFAULT_VENUE_HOURS,
  extractDayClauses,
  extractTimeRange,
  type TimeRange,
  type VenueHours,
} from "./parseBands";

// What an application's free-text 出演希望日 ("17日16:00まで、18日18:30〜",
// "18日のみ", "両日可能", …) actually allows: for each date it names, the
// time window that applies to that date (null = all day). Text that names no
// date at all ("両日可能", blank, or a bare "16時以降でお願いします") doesn't
// restrict the date, so it's treated as available on every day — with its
// time range, if any, applying to all of them. Same reading the auto-
// scheduler's date resolution uses for a band with no date hints.
export type ScheduleAvailability = {
  windows: { day: number; range: TimeRange | null }[];
  /** Only meaningful when `windows` is empty (no date was named). */
  globalRange: TimeRange | null;
};

export function parseScheduleAvailability(
  text: string,
  venue: VenueHours = DEFAULT_VENUE_HOURS,
): ScheduleAvailability {
  const clauses = extractDayClauses(text);
  if (clauses.length === 0) return { windows: [], globalRange: extractTimeRange(text, venue) };
  return {
    windows: clauses.map((c) => ({ day: c.day, range: extractTimeRange(c.clause, venue) })),
    globalRange: null,
  };
}

// start inclusive, end exclusive: "〜16:00" can't start a set at 16:00.
function inRange(range: TimeRange | null, minutes: number): boolean {
  if (!range) return true;
  return (
    (range.startMinutes === null || minutes >= range.startMinutes) &&
    (range.endMinutes === null || minutes < range.endMinutes)
  );
}

/** Can this application play on `day` (and, if given, at `minutes`)? */
export function isAvailableOn(
  availability: ScheduleAvailability,
  day: number,
  minutes: number | null,
): boolean {
  if (availability.windows.length === 0) {
    return minutes === null || inRange(availability.globalRange, minutes);
  }
  return availability.windows.some(
    (w) => w.day === day && (minutes === null || inRange(w.range, minutes)),
  );
}

/** Can it play at `minutes` on at least one day? */
export function isAvailableAtAnyDay(availability: ScheduleAvailability, minutes: number): boolean {
  if (availability.windows.length === 0) return inRange(availability.globalRange, minutes);
  return availability.windows.some((w) => inRange(w.range, minutes));
}

/** The dates and clock boundaries actually written across `all` — what the
 * search UI offers as one-click candidates. */
export function collectScheduleCandidates(all: ScheduleAvailability[]): {
  days: number[];
  times: number[];
} {
  const days = new Set<number>();
  const times = new Set<number>();
  const addRange = (range: TimeRange | null) => {
    if (!range) return;
    if (range.startMinutes !== null) times.add(range.startMinutes);
    if (range.endMinutes !== null) times.add(range.endMinutes);
  };
  for (const availability of all) {
    addRange(availability.globalRange);
    for (const w of availability.windows) {
      days.add(w.day);
      addRange(w.range);
    }
  }
  return {
    days: [...days].sort((a, b) => a - b),
    times: [...times].sort((a, b) => a - b),
  };
}
