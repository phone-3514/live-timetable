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
