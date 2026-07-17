import type { Application, ApplicationMember, ApplicationSetlistItem } from "../types";
import {
  normalizeApplicationText,
  matchBandNameLine,
  matchHeadingField,
  SETLIST_LINE_RE,
  stripSetlistPrefix,
  SLOT_RANK_LINE_RE,
  SYNC_LINE_RE,
  DURATION_LINE_RE,
  SCHEDULE_HEADING_KEYWORDS,
  TIME_HEADING_KEYWORDS,
  looksLikeMemberLine,
  extractMemberDetails,
  detectHasSync,
} from "./parseBands";

// Parses the same Discord chat-log format as the Timetable Editor's
// parseBands (built on the same shared primitives — see parseBands.ts), but
// for the Application Manager: it keeps the submitter/timestamp header as
// separate 申請者氏名/申請日時 fields instead of discarding it, and keeps
// member part/grade and setlist artist split out instead of flattening them
// to plain strings.
//
// Each band's answer is a free-text block like:
//   大久保尚範 Gt. —
//   2026/06/19 18:02
//   バンド名：ロケット少年
//   1.ロケットサイダー/ナユタン星人
//   3年 Gt.大久保尚範
//   同期演奏：なし
//   演奏時間：10分
//   出演希望日：12日13:30-15:30
//
// (The header may also appear as a single line: "大久保尚範 Gt. — 2026/06/19
// 18:02". Both forms occur in practice.)

const DATE_TIME_VALUE_SRC = String.raw`\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}`;
const BARE_DATE_TIME_LINE_RE = new RegExp(`^${DATE_TIME_VALUE_SRC}$`);
const INLINE_HEADER_RE = new RegExp(`^(.+?)\\s*—\\s*(${DATE_TIME_VALUE_SRC})\\s*$`);
const DASH_TRIM_RE = /\s*—\s*$/;

// DiscordChatExporter's plain-text export writes each message as
// "[28-Jun-21 12:00 AM] Username" immediately followed by the message body
// — a different shape from the "Username — 2026/06/19 18:02" header above
// (which is what Discord's own in-client "copy text" produces), so batch
// file uploads of a DiscordChatExporter .txt need this as a second,
// independent header pattern rather than a variant of the first.
const EXPORTER_BRACKET_HEADER_RE =
  /^\[(\d{1,2}-[A-Za-z]{3}-\d{2,4}\s+\d{1,2}:\d{2}\s*[AP]M)\]\s*(.+)$/;

type Header = {
  applicantName: string;
  applicationDateTime: string;
  lineStart: number;
  lineEnd: number;
};

// Looks backward from `beforeIndex` (exclusive) over blank lines for a
// header immediately preceding a バンド名 anchor. Returns the parsed header
// plus the raw line-index range it occupied, so the caller can exclude
// those lines from block content (a header can land inside the *previous*
// band's block range, since it appears right before the next バンド名 line).
function findHeaderBefore(lines: string[], beforeIndex: number): Header | null {
  let i = beforeIndex - 1;
  while (i >= 0 && lines[i].length === 0) i--;
  if (i < 0) return null;

  const inline = INLINE_HEADER_RE.exec(lines[i]);
  if (inline) {
    return {
      applicantName: inline[1].trim(),
      applicationDateTime: inline[2].trim(),
      lineStart: i,
      lineEnd: i,
    };
  }

  const bracket = EXPORTER_BRACKET_HEADER_RE.exec(lines[i]);
  if (bracket) {
    return {
      applicantName: bracket[2].trim(),
      applicationDateTime: bracket[1].trim(),
      lineStart: i,
      lineEnd: i,
    };
  }

  if (BARE_DATE_TIME_LINE_RE.test(lines[i])) {
    const timestampLine = i;
    let j = i - 1;
    while (j >= 0 && lines[j].length === 0) j--;
    if (j >= 0 && lines[j].length > 0) {
      return {
        applicantName: lines[j].replace(DASH_TRIM_RE, "").trim(),
        applicationDateTime: lines[timestampLine],
        lineStart: j,
        lineEnd: timestampLine,
      };
    }
  }

  return null;
}

function splitSetlistEntry(entry: string): ApplicationSetlistItem {
  const slash = entry.match(/^(.+?)\s*[/／]\s*(.+)$/);
  if (slash) return { title: slash[1].trim(), artist: slash[2].trim() };
  return { title: entry.trim(), artist: "" };
}

// Splits raw chat-export text into one string per detected message (header
// line(s) + everything up to the next header), for callers that want to
// drop non-application messages *before* handing text to parseApplications
// — parseApplications only ever excludes a header that sits immediately
// before the *next* バンド名 anchor, so a chatter message sitting between
// two applications (with no anchor of its own) would otherwise be silently
// absorbed into the preceding application's setlist/member fields instead
// of being dropped. Used by parseChatExportFile.ts for the batch
// file-upload flow's noise filtering, and doubles as the "N messages
// processed" count for its summary toast.
export function splitIntoMessageSegments(rawText: string): string[] {
  const normalized = normalizeApplicationText(rawText);
  const lines = normalized.split("\n").map((l) => l.trim());

  const headerStarts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (INLINE_HEADER_RE.test(lines[i]) || EXPORTER_BRACKET_HEADER_RE.test(lines[i])) {
      headerStarts.push(i);
      continue;
    }
    if (BARE_DATE_TIME_LINE_RE.test(lines[i]) && i > 0 && lines[i - 1].length > 0) {
      headerStarts.push(i - 1);
    }
  }
  if (headerStarts.length === 0) return rawText.trim() ? [rawText] : [];

  const segments: string[] = [];
  for (let i = 0; i < headerStarts.length; i++) {
    const start = headerStarts[i];
    const end = i + 1 < headerStarts.length ? headerStarts[i + 1] : lines.length;
    if (end <= start) continue;
    segments.push(lines.slice(start, end).join("\n"));
  }
  return segments;
}

export function parseApplications(rawText: string): Application[] {
  const normalized = normalizeApplicationText(rawText);
  const lines = normalized.split("\n").map((l) => l.trim());

  const anchors: number[] = [];
  lines.forEach((line, i) => {
    if (matchBandNameLine(line) !== null) anchors.push(i);
  });

  const headers = anchors.map((start) => findHeaderBefore(lines, start));

  return anchors.map((start, idx) => {
    const end = idx + 1 < anchors.length ? anchors[idx + 1] : lines.length;
    const header = headers[idx];
    const nextHeader = idx + 1 < anchors.length ? headers[idx + 1] : null;

    const excludedLineIndexes = new Set<number>();
    if (nextHeader) {
      for (let k = nextHeader.lineStart; k <= nextHeader.lineEnd; k++) {
        excludedLineIndexes.add(k);
      }
    }

    const blockLines = lines
      .slice(start, end)
      .map((line, offset) => ({ line, index: start + offset }))
      .filter(({ line, index }) => line.length > 0 && !excludedLineIndexes.has(index))
      .map(({ line }) => line);

    const bandName = matchBandNameLine(blockLines[0])?.trim() ?? "";

    const members: ApplicationMember[] = [];
    const setlist: ApplicationSetlistItem[] = [];
    const scheduleParts: string[] = [];
    let durationMinutes: number | null = null;
    // Same rationale as parseChatLogBands: until a real member line is
    // seen, unmatched lines are still part of the (possibly un-numbered)
    // song list; after members start, only slash-marked lines count as
    // setlist so stray notes aren't misread as songs.
    let seenMemberLine = false;

    const rest = blockLines.slice(1);
    for (let i = 0; i < rest.length; i++) {
      const line = rest[i];
      if (SETLIST_LINE_RE.test(line)) {
        setlist.push(splitSetlistEntry(stripSetlistPrefix(line)));
        continue;
      }
      if (SLOT_RANK_LINE_RE.test(line)) continue;
      if (SYNC_LINE_RE.test(line)) continue;

      const durationMatch = DURATION_LINE_RE.exec(line);
      if (durationMatch) {
        durationMinutes = Number(durationMatch[1]);
        continue;
      }

      const scheduleValue = matchHeadingField(line, SCHEDULE_HEADING_KEYWORDS);
      const timeValue = matchHeadingField(line, TIME_HEADING_KEYWORDS);
      if (scheduleValue !== null || timeValue !== null) {
        const inlineValue = scheduleValue || timeValue;
        if (inlineValue) {
          scheduleParts.push(inlineValue);
        } else if (rest[i + 1]) {
          scheduleParts.push(rest[i + 1]);
          i++;
        }
        continue;
      }

      if (looksLikeMemberLine(line)) {
        seenMemberLine = true;
        members.push(extractMemberDetails(line));
        continue;
      }

      if (!seenMemberLine || line.includes("/")) {
        setlist.push(splitSetlistEntry(line));
        continue;
      }

      members.push(extractMemberDetails(line));
    }

    let parseWarning: string | undefined;
    if (!bandName) {
      parseWarning = "バンド名を検出できませんでした。手動で確認・修正してください";
    } else if (members.length === 0) {
      parseWarning = "メンバーを検出できませんでした。手動で確認・修正してください";
    }

    const blockText = blockLines.join(" / ");

    return {
      id: crypto.randomUUID(),
      applicantName: header?.applicantName ?? "",
      applicationDateTime: header?.applicationDateTime ?? "",
      bandName: bandName || "(バンド名未設定)",
      setlist,
      members,
      hasSync: detectHasSync(blockText),
      durationMinutes,
      desiredDateTime: scheduleParts.join(" / "),
      raw: blockText,
      createdAt: Date.now(),
      approved: false,
      linkedBandId: null,
      parseWarning,
    };
  });
}
