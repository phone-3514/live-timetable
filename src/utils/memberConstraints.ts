import type { Band, TimetableDay, TimetableSlot } from "../types";
import type { MemberReasonNote } from "../types";
import { normalizeMemberName } from "./normalizeMemberName";
import {
  DEFAULT_VENUE_HOURS,
  extractDayClauses,
  extractTimeRange,
  type TimeRange,
  type VenueHours,
} from "./parseBands";
import { timeToMinutes } from "./time";

// 個人の出演不可/可能時間: what a person's own 理由メモ says about when they
// can't (or can only) play — "21日 13:00~不可", "17日は午前のみ可". The memo
// stays free text; this reads each line of it into time windows that the
// scheduling checks (canPlaceBandInSlot, and with it dragging, swapping and
// 一括自動配置) apply to every band the person is in.
//
// Per line, split by the dates it names (the same per-date reading the band's
// own 出演希望日 gets): a clause saying 不可/無理/NG/… is a window the person
// can NOT play in; one saying のみ/だけ/可能/OK/… (without a negative) is the
// only window they CAN play in that day. A time written with no date applies to
// every day. A line that is neither is reported as unrecognised, never guessed.

/** When the timetable is being built, every time restriction is kept this far
 * clear of: a "16:00~不可" person is scheduled to be off by 15:40, an "17:00以降
 * 可能" band starts no earlier than 17:20. */
export const TIME_RESTRICTION_BUFFER_MINUTES = 20;

/**
 * `range` with the safety margin applied. A window the band/person can NOT play
 * in (kind "ng") grows by `buffer` on each bounded side; a window they can ONLY
 * play in (kind "ok") shrinks by it — unless that would leave nothing, when it is
 * kept as written. Unbounded sides stay unbounded.
 */
export function applyTimeBuffer(range: TimeRange | null, kind: "ng" | "ok", buffer: number): TimeRange | null {
  if (!range || buffer <= 0) return range;
  const sign = kind === "ng" ? -1 : 1;
  const start = range.startMinutes !== null ? range.startMinutes + sign * buffer : null;
  const end = range.endMinutes !== null ? range.endMinutes - sign * buffer : null;
  if (kind === "ok" && start !== null && end !== null && start >= end) return range;
  return { startMinutes: start, endMinutes: end };
}

export type MemberWindow = {
  kind: "ng" | "ok";
  /** Day of month the window is for; null = every day (unless `weekday` is set). */
  day: number | null;
  /** Day of the week (0=日 … 6=土) for "土曜は不可"-style windows; the window
   * then applies to every timetable day that falls on that weekday. */
  weekday?: number;
  /** null = the whole day. */
  range: TimeRange | null;
  /** The text this window was read from, for showing back to the organizer. */
  source: string;
};

export type ParsedMemberConstraints = {
  windows: MemberWindow[];
  /** Lines (or clauses) that name a time but not whether it is OK or not OK. */
  unrecognized: string[];
};

const NEGATIVE_RE =
  /不可|無理|ＮＧ|NG|ダメ|だめ|出られ(?:ない|ません)|出れ(?:ない|ません)|参加できな(?:い|いです)|参加できません|参加不可|不参加|欠席|行けな|行けませ|いけな|いけませ|来れな|来れませ|来られな|来られませ|不都合|難しい|都合が悪|厳しい|[×✕✖]/i;
const POSITIVE_RE =
  /のみ|だけ|限定|可能|ＯＫ|OK|大丈夫|出られ(?:る|ます)|出れ(?:る|ます)|参加できる|行けます|行ける|来れます|来られます|[○◯〇]/i;
const TIME_HINT_RE =
  /\d{1,2}\s*(?:[:：]\d{1,2}|時)|午前|午後|夕方|終日|一日中|全日|両日|毎日|\d{1,2}\s*日|[月火水木金土日]曜|土日/;

const WEEKDAY_NUMBER: Record<string, number> = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6 };

/** "土曜" / "日曜日" / "土日" → weekday numbers (0=日 … 6=土). */
function extractWeekdays(text: string): number[] {
  const found = new Set<number>();
  for (const m of text.matchAll(/([月火水木金土日])曜日?/g)) found.add(WEEKDAY_NUMBER[m[1]]);
  if (/土日|土・日|土、日/.test(text)) {
    found.add(6);
    found.add(0);
  }
  return [...found];
}

/** "17,18日" / "17・18日" → "17日、18日", so every date of a list is its own
 * clause. Digits right after a ":" (the minutes of "13:30, 21日") are left alone. */
function expandDayLists(line: string): string {
  return line.replace(/(?<![\d:：])(\d{1,2}(?:\s*[,，、・]\s*\d{1,2})+)\s*日/g, (_, list: string) =>
    list
      .split(/\s*[,，、・]\s*/)
      .map((n) => `${n}日`)
      .join("、"),
  );
}

// A clock time, then the ways a bound is written next to one.
const T = String.raw`\d{1,2}(?:[:：]\d{1,2}|時(?:\d{1,2}分|半)?)`;
const SEP = String.raw`[~〜～\-－–—ー]`;
const RANGE_RE = new RegExp(
  `(${T})\\s*${SEP}\\s*(${T})` + // 10:00~12:00
    `|(${T})\\s*(?:${SEP}|以降|以後|から)` + // 15:30~ / 15:30以降
    `|${SEP}\\s*(${T})` + // ~12:30
    `|(${T})\\s*まで`, // 12:30まで
  "g",
);

function tokenToMinutes(token: string | undefined): number | null {
  if (!token) return null;
  let m = /^(\d{1,2})[:：](\d{1,2})$/.exec(token);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d{1,2})時(\d{1,2})分$/.exec(token);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d{1,2})時半$/.exec(token);
  if (m) return Number(m[1]) * 60 + 30;
  m = /^(\d{1,2})時$/.exec(token);
  if (m) return Number(m[1]) * 60;
  return null;
}

/** Every time range in `text` ("10:00~12:00, 16:00~19:00" is two), plus the
 * 午前/午後/夕方 keywords when no clock time is written. A text with no time at
 * all gives a single null (the whole day). */
function extractAllRanges(text: string): (TimeRange | null)[] {
  const normalized = text.normalize("NFKC");
  const ranges: TimeRange[] = [];
  for (const m of normalized.matchAll(RANGE_RE)) {
    if (m[1] !== undefined) {
      const start = tokenToMinutes(m[1]);
      const end = tokenToMinutes(m[2]);
      if (start !== null && end !== null && end > start) ranges.push({ startMinutes: start, endMinutes: end });
    } else if (m[3] !== undefined) {
      const start = tokenToMinutes(m[3]);
      if (start !== null) ranges.push({ startMinutes: start, endMinutes: null });
    } else if (m[4] !== undefined) {
      const end = tokenToMinutes(m[4]);
      if (end !== null) ranges.push({ startMinutes: null, endMinutes: end });
    } else if (m[5] !== undefined) {
      const end = tokenToMinutes(m[5]);
      if (end !== null) ranges.push({ startMinutes: null, endMinutes: end });
    }
  }
  if (ranges.length > 0) return ranges;
  return [extractTimeRange(text, DEFAULT_VENUE_HOURS)];
}

function polarityOf(text: string): "ng" | "ok" | null {
  if (NEGATIVE_RE.test(text)) return "ng";
  if (POSITIVE_RE.test(text)) return "ok";
  return null;
}

export function parseMemberConstraintText(text: string): ParsedMemberConstraints {
  const windows: MemberWindow[] = [];
  const unrecognized: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = expandDayLists(line.trim().normalize("NFKC"));
    if (!trimmed || !TIME_HINT_RE.test(trimmed)) continue;

    // One ending like "… 不可" often covers every date written before it, so a
    // clause with no word of its own takes the line's — when the line says only
    // one thing. A line saying both (not OK on one date, OK on another) needs
    // each clause to carry its own.
    const hasNeg = NEGATIVE_RE.test(trimmed);
    const hasPos = POSITIVE_RE.test(trimmed);
    const lineKind: "ng" | "ok" | null = hasNeg && hasPos ? null : hasNeg ? "ng" : hasPos ? "ok" : null;

    const clauses = extractDayClauses(trimmed);
    const units: { days: (number | null)[]; weekdays?: number[]; text: string }[] = [];
    if (clauses.length === 0) {
      // No numbered date: "土曜は不可" is a weekday, "両日不可" / a bare time is every day.
      const weekdays = extractWeekdays(trimmed);
      units.push(weekdays.length > 0 ? { days: [null], weekdays, text: trimmed } : { days: [null], text: trimmed });
    } else {
      // "20日, 21日 10:00~13:00 不可": a date with nothing after it shares the
      // next clause's times and word.
      let pending: number[] = [];
      clauses.forEach((clause, i) => {
        const carriesInfo = extractAllRanges(clause.clause).some((r) => r !== null) || polarityOf(clause.clause) !== null;
        if (!carriesInfo && i < clauses.length - 1) {
          pending.push(clause.day);
          return;
        }
        units.push({ days: [...pending, clause.day], text: clause.clause });
        pending = [];
      });
    }

    for (const unit of units) {
      const kind = polarityOf(unit.text) ?? lineKind;
      if (!kind) {
        unrecognized.push(unit.text.trim());
        continue;
      }
      const ranges = extractAllRanges(unit.text);
      if (unit.weekdays) {
        for (const weekday of unit.weekdays) {
          for (const range of ranges) windows.push({ kind, day: null, weekday, range, source: unit.text.trim() });
        }
      } else {
        for (const day of unit.days) {
          for (const range of ranges) windows.push({ kind, day, range, source: unit.text.trim() });
        }
      }
    }
  }
  return { windows, unrecognized };
}

// ---------- registry ------------------------------------------------------
//
// The scheduling checks are pure functions called from many places (the solver,
// drag highlighting, swapping, the store), none of which has the member notes
// at hand — so the notes are read into this registry whenever they change (see
// useApplicationStore) and canPlaceBandInSlot consults it. normalizeMemberName
// of the person's name is the key.

let registry = new Map<string, MemberWindow[]>();

export function setMemberConstraintRegistry(notes: MemberReasonNote[]): void {
  const next = new Map<string, MemberWindow[]>();
  for (const note of notes) {
    const parsed = parseMemberConstraintText(note.note);
    if (parsed.windows.length > 0) next.set(note.key, parsed.windows);
  }
  registry = next;
}

const parseCache = new Map<string, MemberWindow[]>();

/** parseMemberConstraintText(text).windows, remembered by text — the placement
 * checks run this for a band's own 理由メモ on every slot they test. */
export function parseConstraintWindowsCached(text: string | undefined): MemberWindow[] {
  if (!text) return [];
  const hit = parseCache.get(text);
  if (hit) return hit;
  const windows = parseMemberConstraintText(text).windows;
  if (parseCache.size > 500) parseCache.clear();
  parseCache.set(text, windows);
  return windows;
}

export function getMemberWindows(memberName: string): MemberWindow[] {
  return registry.get(normalizeMemberName(memberName)) ?? [];
}

function overlaps(range: TimeRange | null, start: number, end: number): boolean {
  if (!range) return true;
  const rangeStart = range.startMinutes ?? -Infinity;
  const rangeEnd = range.endMinutes ?? Infinity;
  return start < rangeEnd && rangeStart < end;
}

export function dayOfMonthOf(day: Pick<TimetableDay, "date">): number | null {
  if (!day.date) return null;
  return Number(day.date.slice(8, 10)) || null;
}

/** 0=日 … 6=土 for the day's calendar date (null when it has none). */
export function weekdayOf(day: Pick<TimetableDay, "date">): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.date ?? "");
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
}

/** Does this person's constraint list keep them out of [start, end) on `dom`?
 * `bufferMinutes` > 0 keeps the slot that far clear of every window's edges. */
export function windowsBlock(
  windows: MemberWindow[],
  dom: number | null,
  start: number,
  end: number,
  bufferMinutes = 0,
  weekday: number | null = null,
): boolean {
  const applies = (w: MemberWindow) =>
    w.weekday !== undefined
      ? weekday !== null && w.weekday === weekday
      : w.day === null || (dom !== null && w.day === dom);
  const ng = windows.filter((w) => w.kind === "ng" && applies(w));
  if (ng.some((w) => overlaps(applyTimeBuffer(w.range, "ng", bufferMinutes), start, end))) return true;
  const ok = windows.filter((w) => w.kind === "ok" && applies(w));
  return ok.length > 0 && !ok.some((w) => overlaps(applyTimeBuffer(w.range, "ok", bufferMinutes), start, end));
}

/** Names of the band's members whose own constraints rule out this slot. */
export function findMemberConstraintViolations(
  band: Pick<Band, "members">,
  day: Pick<TimetableDay, "date">,
  slot: Pick<TimetableSlot, "startTime" | "endTime" | "customLabel">,
  _venue: VenueHours = DEFAULT_VENUE_HOURS,
  bufferMinutes = 0,
): string[] {
  if (registry.size === 0 || slot.customLabel !== null || !slot.startTime || !slot.endTime) return [];
  const start = timeToMinutes(slot.startTime);
  const end = timeToMinutes(slot.endTime);
  const dom = dayOfMonthOf(day);
  const weekday = weekdayOf(day);
  return band.members.filter((name) => windowsBlock(getMemberWindows(name), dom, start, end, bufferMinutes, weekday));
}

/** Short Japanese description of one window, e.g. "21日 13:00〜 出演不可". */
export function describeMemberWindow(w: MemberWindow): string {
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const when = w.range
    ? `${w.range.startMinutes !== null ? fmt(w.range.startMinutes) : ""}〜${w.range.endMinutes !== null ? fmt(w.range.endMinutes) : ""}`
    : "終日";
  const dayLabel =
    w.weekday !== undefined ? `${"日月火水木金土"[w.weekday]}曜 ` : w.day !== null ? `${w.day}日 ` : "全日 ";
  return `${dayLabel}${when} ${w.kind === "ng" ? "出演不可" : "この時間のみ可"}`;
}
