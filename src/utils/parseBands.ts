import type { Band } from "../types";

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
    let durationMinutes: number | undefined;

    for (const line of blockLines.slice(1)) {
      if (SETLIST_LINE_RE.test(line)) continue;
      if (SYNC_LINE_RE.test(line)) continue;
      if (HEADER_LINE_RE.test(line)) continue;
      const durationMatch = DURATION_LINE_RE.exec(line);
      if (durationMatch) {
        durationMinutes = Number(durationMatch[1]);
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
      desiredTime: "",
      ngTime: "",
      durationMinutes,
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
