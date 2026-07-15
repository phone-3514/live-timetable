import type { Band } from "../types";

// ---------- Date hints (e.g. "13日", "14日のみ") ----------
//
// Multi-day events are often specified by organizers as concrete calendar
// dates ("13日", "14日") rather than "1日目"/"2日目". These hints get
// resolved into actual TimetableDay ids later (once the organizer has set
// each day's calendar date) via resolveAllowedDayIds in the store.

export function extractDayOfMonthHints(text: string): number[] {
  if (!text) return [];
  const matches = [...text.matchAll(/(\d{1,2})\s*日/g)];
  return [...new Set(matches.map((m) => Number(m[1])))];
}

// ---------- Time-of-day hints (e.g. "18:00-19:00", "10時〜14時") ----------
//
// Pulled directly from desiredTime/ngTime whenever needed (not stored on
// the Band) so edits to those free-text fields stay automatically in sync.
// "終日" (all day) and similar free text with no parseable range simply
// yield null, which callers already treat as "no time restriction".

// A time token must carry an explicit hour marker (":"/"："/"時") so this
// never matches an unrelated bare number like the "1" in a setlist line.
const TIME_TOKEN_SRC = String.raw`\d{1,2}(?:[:：]\d{1,2}|時(?:\d{1,2}分)?)`;
const TIME_RANGE_RE = new RegExp(
  `(${TIME_TOKEN_SRC})\\s*[-~〜ー]\\s*(${TIME_TOKEN_SRC})`,
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

export type TimeRange = { startMinutes: number; endMinutes: number };

export function extractTimeRange(text: string): TimeRange | null {
  if (!text) return null;
  const m = TIME_RANGE_RE.exec(text);
  if (!m) return null;
  const startMinutes = parseTimeToken(m[1]);
  const endMinutes = parseTimeToken(m[2]);
  if (startMinutes === null || endMinutes === null) return null;
  if (endMinutes <= startMinutes) return null;
  return { startMinutes, endMinutes };
}

// ---------- Format detection ----------

const CHAT_LOG_BAND_NAME_RE = /^バンド名\s*[:：]/m;

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

const BAND_NAME_LINE_RE = /^バンド名\s*[:：]\s*(.*)$/;
const SETLIST_LINE_RE = /^\d+[.．]/;
const SYNC_LINE_RE = /^同期演奏/;
const DURATION_LINE_RE = /^(?:演奏時間|出演時間)\s*[:：]?\s*(\d+)\s*分/;
// The next band's "submitter — timestamp" header line can fall inside the
// current band's block range (it appears right before the next バンド名
// line), so it must be filtered out explicitly rather than assumed absent.
const HEADER_LINE_RE = /—\s*\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}\s*$/;

// Discord application posts often use a heading — either bracketed
// ("【希望日程】") or colon-suffixed ("希望時間：") — for the desired
// schedule/time, sometimes with the value on the same line and sometimes on
// the next. Both variants feed into desiredTime, where the existing
// day-of-month and time-range hint extractors already know how to read
// them (including "終日" cleanly falling through as "no restriction").
const SCHEDULE_HEADING_RE =
  /^(?:【\s*(?:希望日程|希望日|出演希望日|参加可能日)\s*】|(?:希望日程|希望日|出演希望日|参加可能日)\s*[:：])\s*(.*)$/;
const TIME_HEADING_RE =
  /^(?:【\s*(?:希望時間|出演可能時間|時間帯|出演時間帯)\s*】|(?:希望時間|出演可能時間|時間帯|出演時間帯)\s*[:：])\s*(.*)$/;

function matchHeadingValue(line: string, re: RegExp): string | null {
  const m = re.exec(line);
  return m ? m[1].trim() : null;
}

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
    if (BAND_NAME_LINE_RE.test(line)) anchors.push(i);
  });

  return anchors.map((start, idx) => {
    const end = idx + 1 < anchors.length ? anchors[idx + 1] : lines.length;
    const blockLines = lines.slice(start, end).filter((l) => l.length > 0);

    const nameMatch = BAND_NAME_LINE_RE.exec(blockLines[0]);
    const name = nameMatch?.[1]?.trim() ?? "";

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
      const scheduleValue = matchHeadingValue(line, SCHEDULE_HEADING_RE);
      const timeValue = matchHeadingValue(line, TIME_HEADING_RE);
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

    return {
      id: crypto.randomUUID(),
      name: name || "(バンド名未設定)",
      members,
      desiredTime: scheduleTimeParts.join(" / "),
      ngTime: "",
      durationMinutes,
      allowedDayIds: [],
      raw: blockLines.join(" / "),
      parseWarning,
    };
  });
}

// ---------- Entry point ----------

export function parseBands(rawText: string): Band[] {
  return detectFormat(rawText) === "chatlog"
    ? parseChatLogBands(rawText)
    : parseTableBands(rawText);
}
