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

export type MemberWindow = {
  kind: "ng" | "ok";
  /** Day of month the window is for; null = every day. */
  day: number | null;
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

const NEGATIVE_RE = /不可|無理|ＮＧ|NG|ダメ|だめ|出られ(?:ない|ません)|参加できない|参加不可|不参加|難しい|都合が悪|厳しい/i;
const POSITIVE_RE = /のみ|だけ|限定|可能|ＯＫ|OK|大丈夫|出られ(?:る|ます)|参加できる/i;
const TIME_HINT_RE = /\d{1,2}\s*(?:[:：]\d{1,2}|時)|午前|午後|夕方|終日|一日中|全日|\d{1,2}\s*日/;

function parseClause(text: string, day: number | null, windows: MemberWindow[], unrecognized: string[]) {
  const trimmed = text.trim();
  if (!trimmed || !TIME_HINT_RE.test(trimmed)) return;
  const negative = NEGATIVE_RE.test(trimmed);
  const positive = POSITIVE_RE.test(trimmed);
  if (!negative && !positive) {
    unrecognized.push(trimmed);
    return;
  }
  windows.push({
    kind: negative ? "ng" : "ok",
    day,
    range: extractTimeRange(trimmed, DEFAULT_VENUE_HOURS),
    source: trimmed,
  });
}

export function parseMemberConstraintText(text: string): ParsedMemberConstraints {
  const windows: MemberWindow[] = [];
  const unrecognized: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const clauses = extractDayClauses(trimmed);
    if (clauses.length === 0) {
      parseClause(trimmed, null, windows, unrecognized);
    } else {
      for (const clause of clauses) parseClause(clause.clause, clause.day, windows, unrecognized);
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

export function getMemberWindows(memberName: string): MemberWindow[] {
  return registry.get(normalizeMemberName(memberName)) ?? [];
}

function overlaps(range: TimeRange | null, start: number, end: number): boolean {
  if (!range) return true;
  const rangeStart = range.startMinutes ?? -Infinity;
  const rangeEnd = range.endMinutes ?? Infinity;
  return start < rangeEnd && rangeStart < end;
}

function dayOfMonthOf(day: Pick<TimetableDay, "date">): number | null {
  if (!day.date) return null;
  return Number(day.date.slice(8, 10)) || null;
}

/** Does this person's constraint list keep them out of [start, end) on `dom`? */
export function windowsBlock(windows: MemberWindow[], dom: number | null, start: number, end: number): boolean {
  const applies = (w: MemberWindow) => w.day === null || (dom !== null && w.day === dom);
  const ng = windows.filter((w) => w.kind === "ng" && applies(w));
  if (ng.some((w) => overlaps(w.range, start, end))) return true;
  const ok = windows.filter((w) => w.kind === "ok" && applies(w));
  return ok.length > 0 && !ok.some((w) => overlaps(w.range, start, end));
}

/** Names of the band's members whose own constraints rule out this slot. */
export function findMemberConstraintViolations(
  band: Pick<Band, "members">,
  day: Pick<TimetableDay, "date">,
  slot: Pick<TimetableSlot, "startTime" | "endTime" | "customLabel">,
  _venue: VenueHours = DEFAULT_VENUE_HOURS,
): string[] {
  if (registry.size === 0 || slot.customLabel !== null || !slot.startTime || !slot.endTime) return [];
  const start = timeToMinutes(slot.startTime);
  const end = timeToMinutes(slot.endTime);
  const dom = dayOfMonthOf(day);
  return band.members.filter((name) => windowsBlock(getMemberWindows(name), dom, start, end));
}

/** Short Japanese description of one window, e.g. "21日 13:00〜 出演不可". */
export function describeMemberWindow(w: MemberWindow): string {
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const when = w.range
    ? `${w.range.startMinutes !== null ? fmt(w.range.startMinutes) : ""}〜${w.range.endMinutes !== null ? fmt(w.range.endMinutes) : ""}`
    : "終日";
  return `${w.day !== null ? `${w.day}日 ` : "全日 "}${when} ${w.kind === "ng" ? "出演不可" : "この時間のみ可"}`;
}
