import type { Band } from "../types";
import { timeToMinutes } from "./time";

// ---------- Typo/synonym normalization ----------
//
// A small dictionary of misspellings and club-specific shorthand, applied
// to the whole pasted text before any parsing. Longer/more-specific
// patterns are listed before shorter ones they contain (カラオケ before
// オケ) so replacing the short form second can't mangle the long one.
// Some entries below are redundant with keywords the sync/keyboard
// detectors already recognize on their own (オケ, 鍵盤) — kept anyway per
// the request for an explicit dictionary, and harmless since normalizing
// to another already-recognized keyword doesn't change detection results.
const NORMALIZATION_DICT: Array<[RegExp, string]> = [
  [/バイト名/g, "バンド名"],
  [/カラオケ/g, "同期"],
  [/オケ/g, "同期"],
  [/キーボ(?!ード)/g, "キーボード"],
  [/鍵盤/g, "Key"],
];

export function normalizeApplicationText(text: string): string {
  return NORMALIZATION_DICT.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    text,
  );
}

// ---------- Fuzzy heading matching (Levenshtein distance) ----------
//
// Bracketed headings ("【バンド名】") are common Discord-form typo targets
// ("【バイト名】", "【出演可農時間】"). A small edit-distance check lets a
// label with 1-2 character mistakes still resolve to its intended field
// without a dedicated regex per typo. Colon headings ("バンド名：...") stay
// exact-match only — without the bracket delimiters there's no safe way to
// isolate "the label" from ordinary prose that happens to contain a colon,
// so fuzzy-matching there risks misreading unrelated text as a heading.
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

const FUZZY_MAX_DISTANCE = 2;

function fuzzyIncludes(label: string, keywords: string[]): boolean {
  return keywords.some((kw) => {
    if (label === kw) return true;
    if (Math.abs(label.length - kw.length) > FUZZY_MAX_DISTANCE) return false;
    return levenshtein(label, kw) <= FUZZY_MAX_DISTANCE;
  });
}

// Extracts {label, value} from a bracket ("【label】value") or colon
// ("label：value") heading line. Returns null for lines that don't look
// like a heading (label must be short and contain no spaces of its own —
// ordinary sentences rarely start that way).
function splitHeadingLine(
  line: string,
): { label: string; value: string; isBracket: boolean } | null {
  const bracket = /^【\s*([^【】]{1,10})\s*】\s*(.*)$/.exec(line);
  if (bracket) {
    return { label: bracket[1].trim(), value: bracket[2].trim(), isBracket: true };
  }
  const colon = /^([^\s:：【]{1,10})\s*[:：]\s*(.*)$/.exec(line);
  if (colon) {
    return { label: colon[1].trim(), value: colon[2].trim(), isBracket: false };
  }
  return null;
}

// Bracketed headings get typo tolerance; colon headings require an exact
// keyword match (see the module comment above for why).
function matchHeadingField(line: string, keywords: string[]): string | null {
  const split = splitHeadingLine(line);
  if (!split) return null;
  const exact = keywords.some((kw) => split.label === kw);
  const matched = exact || (split.isBracket && fuzzyIncludes(split.label, keywords));
  return matched ? split.value : null;
}

// A day-of-month must be a real calendar day (1-31). Listing the longer
// alternatives first lets regex backtracking self-correct glued digit runs:
// e.g. in "9/514:00" greedily reading "51" as the day fails this alternation
// (no valid branch matches "51"), so the engine falls back to the 1-digit
// "5" and leaves "14:00" for the time-token matcher to pick up — the date
// and time separate themselves without any dedicated "de-glue" step.
const DAY_NUM_SRC = String.raw`(?:3[01]|[12]\d|[1-9])`;

// ---------- Date hints (e.g. "13日", "14日のみ", "7/13", "9/5") ----------
//
// Multi-day events are often specified by organizers as concrete calendar
// dates rather than "1日目"/"2日目". These hints get resolved into actual
// TimetableDay ids later (once the organizer has set each day's calendar
// date) via resolveAllowedDayIds in the store. Only the day-of-month is
// kept (month is ignored) — see resolveAllowedDayIds for why that's safe
// for short multi-day events.
const DAY_SUFFIX_RE = new RegExp(`(${DAY_NUM_SRC})\\s*日`, "g");
const SLASH_DATE_RE = new RegExp(`\\d{1,2}\\/(${DAY_NUM_SRC})`, "g");

export function extractDayOfMonthHints(text: string): number[] {
  if (!text) return [];
  const hits = new Set<number>();
  for (const m of text.matchAll(DAY_SUFFIX_RE)) hits.add(Number(m[1]));
  for (const m of text.matchAll(SLASH_DATE_RE)) hits.add(Number(m[1]));
  return [...hits];
}

// ---------- Time-of-day hints (e.g. "18:00-19:00", "10時〜14時", -----------
// ---------- "14時以降", "〜14:00", "14時まで") -----------------------------
//
// Pulled directly from desiredTime/ngTime whenever needed (not stored on
// the Band) so edits to those free-text fields stay automatically in sync.
// "終日" (all day) and similar free text with no parseable range simply
// yield null, which callers already treat as "no time restriction".
//
// A range can be open-ended: startMinutes/endMinutes is null when the text
// only bounds one side ("14時以降" = from 14:00 onward, "〜14:00"/"14時まで"
// = up until 14:00).

// A time token must carry an explicit hour marker (":"/"："/"時") so this
// never matches an unrelated bare number like the "1" in a setlist line.
const TIME_TOKEN_SRC = String.raw`\d{1,2}(?:[:：]\d{1,2}|時(?:\d{1,2}分)?)`;
const TIME_RANGE_RE = new RegExp(
  `(${TIME_TOKEN_SRC})\\s*[-~〜ー]\\s*(${TIME_TOKEN_SRC})`,
);
// Checked only once a closed range has failed to match, so any remaining
// "token then separator/以降/以後/から" is unambiguously open-ended.
const OPEN_AFTER_RE = new RegExp(
  `(${TIME_TOKEN_SRC})\\s*(?:[-~〜ー]|以降|以後|から)`,
);
// Same reasoning in the other direction: "separator then token" with no
// preceding token, or an explicit "まで" (until) suffix.
const OPEN_BEFORE_RE = new RegExp(
  `[-~〜ー]\\s*(${TIME_TOKEN_SRC})|(${TIME_TOKEN_SRC})\\s*まで`,
);

function parseTimeToken(token: string): number | null {
  const t = token.trim();
  let m = /^(\d{1,2})[:：](\d{1,2})$/.exec(t);
  if (m) return toMinutes(Number(m[1]), Number(m[2]));
  m = /^(\d{1,2})時(\d{1,2})分$/.exec(t);
  if (m) return toMinutes(Number(m[1]), Number(m[2]));
  m = /^(\d{1,2})時$/.exec(t);
  if (m) return toMinutes(Number(m[1]), 0);
  return null;
}

function toMinutes(hour: number, minute: number): number | null {
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

// null bound = unbounded on that side (from the beginning / until the end).
export type TimeRange = { startMinutes: number | null; endMinutes: number | null };

// The venue's daily open/close time, referenced by the natural-language
// keyword mappings below ("午前中" etc. have no numbers of their own to
// parse, so they borrow these instead). Configurable in the UI — see
// useAppStore's venueHours — with these as the fallback default.
export type VenueHours = { openTime: string; closeTime: string };
export const DEFAULT_VENUE_HOURS: VenueHours = { openTime: "09:00", closeTime: "21:00" };

const NOON_MINUTES = 12 * 60;
const EVENING_MINUTES = 16 * 60;

// Checked before any numeric parsing, per the request that keyword phrases
// take priority — a band that wrote "午前中" didn't also write a "9:00"
// anywhere for the numeric path to find. Returns:
//   - a TimeRange for phrases that bound one side of the day (午前中/午後/
//     夕方以降),
//   - null for phrases that explicitly mean no restriction (終日/いつでも/
//     指定なし) — same "unrestricted" signal callers already treat null as,
//   - undefined when no keyword matched, so the caller falls through to the
//     numeric parsing below.
function matchKeywordTimeRange(
  text: string,
  venue: VenueHours,
): TimeRange | null | undefined {
  if (text.includes("終日") || text.includes("いつでも") || text.includes("指定なし")) {
    return null;
  }
  if (text.includes("午前")) {
    return { startMinutes: timeToMinutes(venue.openTime), endMinutes: NOON_MINUTES };
  }
  if (text.includes("夕方")) {
    return { startMinutes: EVENING_MINUTES, endMinutes: timeToMinutes(venue.closeTime) };
  }
  if (text.includes("午後")) {
    return { startMinutes: NOON_MINUTES, endMinutes: timeToMinutes(venue.closeTime) };
  }
  return undefined;
}

export function extractTimeRange(
  text: string,
  venue: VenueHours = DEFAULT_VENUE_HOURS,
): TimeRange | null {
  if (!text) return null;

  const keywordRange = matchKeywordTimeRange(text, venue);
  if (keywordRange !== undefined) return keywordRange;

  const closed = TIME_RANGE_RE.exec(text);
  if (closed) {
    const startMinutes = parseTimeToken(closed[1]);
    const endMinutes = parseTimeToken(closed[2]);
    if (startMinutes !== null && endMinutes !== null && endMinutes > startMinutes) {
      return { startMinutes, endMinutes };
    }
  }

  const openAfter = OPEN_AFTER_RE.exec(text);
  if (openAfter) {
    const startMinutes = parseTimeToken(openAfter[1]);
    if (startMinutes !== null) return { startMinutes, endMinutes: null };
  }

  const openBefore = OPEN_BEFORE_RE.exec(text);
  if (openBefore) {
    const endMinutes = parseTimeToken(openBefore[1] ?? openBefore[2]);
    if (endMinutes !== null) return { startMinutes: null, endMinutes };
  }

  return null;
}

// ---------- Equipment hints (同期演奏 / キーボード) ----------
//
// An explicit "同期演奏：あり/なし" answer (common in the chat-log format)
// is authoritative; otherwise fall back to scanning the band's whole text
// for the keyword (covers the table-paste format, which has no such
// heading, and free-text mentions like "オケ音源を使用"). Either way, a
// keyword immediately followed by a negation ("オケ無し", "Key不要") must
// not flag the band as having that equipment — see hasUnnegatedMatch.
const SYNC_ANSWER_RE = /同期演奏\s*[:：]?\s*(あり|なし|有|無)/;
const SYNC_KEYWORD_RE = /同期|オケ|PC/g;
const KEYBOARD_KEYWORD_RE = /key|キーボード|鍵盤/gi;

// Checked against the text immediately following a keyword match. Allows an
// optional topic particle ("は"/"も") and/or punctuation between the
// keyword and the negation word, so both "オケ無し" (glued) and "オケは
// 使わない" (particle in between) are caught.
const NEGATION_RE =
  /^[はも]?\s*[:：、,]?\s*(なし|無し|不要|使わない|使用しない|ありません|無い|いらない)/;

function hasUnnegatedMatch(text: string, keywordRe: RegExp): boolean {
  for (const m of text.matchAll(keywordRe)) {
    const after = text.slice(m.index + m[0].length);
    if (!NEGATION_RE.test(after)) return true;
  }
  return false;
}

export function detectHasSync(text: string): boolean {
  if (!text) return false;
  const explicit = SYNC_ANSWER_RE.exec(text);
  if (explicit) return explicit[1] === "あり" || explicit[1] === "有";
  return hasUnnegatedMatch(text, SYNC_KEYWORD_RE);
}

export function detectHasKeyboard(text: string): boolean {
  if (!text) return false;
  return hasUnnegatedMatch(text, KEYBOARD_KEYWORD_RE);
}

// ---------- Format detection ----------

const CHAT_LOG_BAND_NAME_RE = /^(?:バンド名\s*[:：]|【\s*バンド名\s*】)/m;

export function detectFormat(rawText: string): "chatlog" | "table" {
  return CHAT_LOG_BAND_NAME_RE.test(rawText) ? "chatlog" : "table";
}

// ---------- Table (spreadsheet paste) format ----------

const HEADER_KEYWORDS = ["バンド", "団体", "メンバー", "希望", "NG", "ng"];

function splitColumns(line: string): string[] {
  if (line.includes("\t")) return line.split("\t");
  if (line.includes(",")) return line.split(",");
  const spaceSplit = line.split(/\s{2,}/);
  if (spaceSplit.length > 1) return spaceSplit;
  return [line];
}

function splitMembers(cell: string): string[] {
  return cell
    .split(/[、,・\/\n]+/)
    .map((m) => m.trim())
    .filter(Boolean);
}

function looksLikeHeader(cols: string[]): boolean {
  const joined = cols.join(" ");
  return HEADER_KEYWORDS.some((kw) => joined.includes(kw));
}

type ColumnMap = {
  name: number;
  members: number;
  desiredTime: number;
  ngTime: number;
};

function detectColumnMap(headerCols: string[]): ColumnMap {
  const find = (keywords: string[], fallback: number) => {
    const idx = headerCols.findIndex((c) =>
      keywords.some((kw) => c.includes(kw)),
    );
    return idx >= 0 ? idx : fallback;
  };
  return {
    name: find(["バンド", "団体", "名前"], 0),
    members: find(["メンバー", "member"], 1),
    desiredTime: find(["希望"], 2),
    ngTime: find(["NG", "ng"], 3),
  };
}

const DEFAULT_MAP: ColumnMap = {
  name: 0,
  members: 1,
  desiredTime: 2,
  ngTime: 3,
};

function parseTableBands(rawText: string): Band[] {
  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  let map = DEFAULT_MAP;
  let dataLines = lines;
  const firstCols = splitColumns(lines[0]);
  if (looksLikeHeader(firstCols)) {
    map = detectColumnMap(firstCols);
    dataLines = lines.slice(1);
  }

  return dataLines.map((line) => {
    const cols = splitColumns(line).map((c) => c.trim());
    const name = cols[map.name] ?? "";
    const membersCell = cols[map.members] ?? "";
    const desiredTime = cols[map.desiredTime] ?? "";
    const ngTime = cols[map.ngTime] ?? "";

    let parseWarning: string | undefined;
    if (cols.length < 2 || !name) {
      parseWarning = "解析できませんでした。手動で確認・修正してください";
    }

    return {
      id: crypto.randomUUID(),
      name: name || "(バンド名未設定)",
      members: splitMembers(membersCell),
      desiredTime,
      ngTime,
      allowedDayIds: [],
      hasSync: detectHasSync(line),
      hasKeyboard: detectHasKeyboard(line),
      raw: line,
      parseWarning,
    };
  });
}

// ---------- Chat-log (Discord/Slack survey) format ----------
//
// Each band's answer is a free-text block like:
//   堀切桃花(副部長) Ba. — 2026/06/28 17:33   <- submitter/timestamp, not band data
//   バンド名：RADWIMPS
//   1.One man live/RADWIMPS
//   2.未定
//   2年 Gt.Vo. 弓納持要
//   2年 Ba. 堀切桃花
//   同期演奏：あり
//   演奏時間：10分
//
// Blocks are anchored on "バンド名：" lines so the submitter/timestamp
// header line is never mistaken for a band.

const BAND_NAME_KEYWORDS = ["バンド名"];
const SCHEDULE_HEADING_KEYWORDS = ["希望日程", "希望日", "出演希望日", "参加可能日"];
const TIME_HEADING_KEYWORDS = ["希望時間", "出演可能時間", "時間帯", "出演時間帯"];

function matchBandNameLine(line: string): string | null {
  return matchHeadingField(line, BAND_NAME_KEYWORDS);
}

const SETLIST_LINE_RE = /^\d+[.．]/;
const SYNC_LINE_RE = /^同期演奏/;
const DURATION_LINE_RE = /^(?:演奏時間|出演時間)\s*[:：]?\s*(\d+)\s*分/;
// The next band's "submitter — timestamp" header line can fall inside the
// current band's block range (it appears right before the next バンド名
// line), so it must be filtered out explicitly rather than assumed absent.
const HEADER_LINE_RE = /—\s*\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}\s*$/;

// A "part label" is the instrument abbreviation prefixed to a member's
// name, e.g. "Gt.Vo.", "Ba.", "Key./Vo.". Members are always written as
// "<grade> <part label><name>", so taking everything after the LAST
// such label on the line isolates the name regardless of spacing style.
const PART_LABEL_RE = /[A-Za-z]+(?:[.\/][A-Za-z]+)*\.?/g;

function extractMemberName(line: string): string {
  const matches = [...line.matchAll(PART_LABEL_RE)];
  if (matches.length === 0) return line.trim();
  const last = matches[matches.length - 1];
  const rest = line.slice((last.index ?? 0) + last[0].length).trim();
  return rest || line.trim();
}

function parseChatLogBands(rawText: string): Band[] {
  const lines = rawText.split("\n").map((l) => l.trim());
  const anchors: number[] = [];
  lines.forEach((line, i) => {
    if (matchBandNameLine(line) !== null) anchors.push(i);
  });

  return anchors.map((start, idx) => {
    const end = idx + 1 < anchors.length ? anchors[idx + 1] : lines.length;
    const blockLines = lines.slice(start, end).filter((l) => l.length > 0);

    const name = matchBandNameLine(blockLines[0])?.trim() ?? "";

    const members: string[] = [];
    const scheduleTimeParts: string[] = [];
    let durationMinutes: number | undefined;

    const rest = blockLines.slice(1);
    for (let i = 0; i < rest.length; i++) {
      const line = rest[i];
      if (SETLIST_LINE_RE.test(line)) continue;
      if (SYNC_LINE_RE.test(line)) continue;
      if (HEADER_LINE_RE.test(line)) continue;

      const durationMatch = DURATION_LINE_RE.exec(line);
      if (durationMatch) {
        durationMinutes = Number(durationMatch[1]);
        continue;
      }

      // Bracketed/colon headings sometimes carry the value on the same
      // line ("希望時間：10:00-14:00") and sometimes on their own line
      // with the value below ("【希望日程】" then "7/13" next line).
      const scheduleValue = matchHeadingField(line, SCHEDULE_HEADING_KEYWORDS);
      const timeValue = matchHeadingField(line, TIME_HEADING_KEYWORDS);
      if (scheduleValue !== null || timeValue !== null) {
        const inlineValue = scheduleValue || timeValue;
        if (inlineValue) {
          scheduleTimeParts.push(inlineValue);
        } else if (rest[i + 1]) {
          scheduleTimeParts.push(rest[i + 1]);
          i++;
        }
        continue;
      }

      members.push(extractMemberName(line));
    }

    let parseWarning: string | undefined;
    if (!name) {
      parseWarning = "バンド名を検出できませんでした。手動で確認・修正してください";
    } else if (members.length === 0) {
      parseWarning = "メンバーを検出できませんでした。手動で確認・修正してください";
    }

    // The next band's submitter/timestamp header line can land inside this
    // block's raw range (see HEADER_LINE_RE above) — excluded here too so
    // it can't leak into hasSync/hasKeyboard keyword scanning or the raw
    // debug field, the same way it's already excluded from members.
    const blockText = blockLines
      .filter((l) => !HEADER_LINE_RE.test(l))
      .join(" / ");

    return {
      id: crypto.randomUUID(),
      name: name || "(バンド名未設定)",
      members,
      desiredTime: scheduleTimeParts.join(" / "),
      ngTime: "",
      durationMinutes,
      allowedDayIds: [],
      hasSync: detectHasSync(blockText),
      hasKeyboard: detectHasKeyboard(blockText),
      raw: blockText,
      parseWarning,
    };
  });
}

// ---------- Entry point ----------

export function parseBands(rawText: string): Band[] {
  const normalized = normalizeApplicationText(rawText);
  return detectFormat(normalized) === "chatlog"
    ? parseChatLogBands(normalized)
    : parseTableBands(normalized);
}
