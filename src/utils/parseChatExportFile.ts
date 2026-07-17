import type { Application } from "../types";
import { parseApplications, splitIntoMessageSegments } from "./parseApplications";
import { matchBandNameLine, normalizeApplicationText } from "./parseBands";

type ExportedMessage = { author: string; timestamp: string; content: string };

// DiscordChatExporter's JSON export shape (only the fields we read):
//   { "messages": [ { "timestamp": "2026-06-19T18:02:00+09:00",
//                      "author": { "name": "...", "nickname": "..." },
//                      "content": "..." }, ... ] }
type DiscordExportJson = {
  messages?: Array<{
    timestamp?: string;
    author?: { name?: string; nickname?: string };
    content?: string;
  }>;
};

function isDiscordExportJson(value: unknown): value is DiscordExportJson {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as DiscordExportJson).messages)
  );
}

// Reformats an ISO timestamp's literal wall-clock date/time (ignoring its
// offset) into "YYYY/M/D H:MM" — the shape parseApplications' header regexes
// expect. Using new Date().getHours() etc. here would silently shift the
// hour to the browser's local timezone, which for an export made in one
// timezone and opened in another would show the wrong submission time.
function formatExportedTimestamp(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!match) return iso;
  const [, y, mo, d, h, mi] = match;
  return `${y}/${Number(mo)}/${Number(d)} ${Number(h)}:${mi}`;
}

function extractDiscordJsonMessages(data: DiscordExportJson): ExportedMessage[] {
  return (data.messages ?? []).map((m) => ({
    author: m.author?.nickname || m.author?.name || "",
    timestamp: m.timestamp ? formatExportedTimestamp(m.timestamp) : "",
    content: m.content ?? "",
  }));
}

// Reconstructs messages back into the "Username — 2026/06/19 18:02\ncontent"
// shape the existing chat-log parser already understands, so JSON-exported
// applications go through the exact same anchor/header/field-extraction
// logic as a manual textarea paste instead of a second parallel parser.
function buildPseudoChatText(messages: ExportedMessage[]): string {
  return messages
    .map((m) => `${m.author} — ${m.timestamp}\n${m.content}`)
    .join("\n\n");
}

// A message with no バンド名 line anywhere in it can't be an application by
// definition (parseApplications only ever starts a block at such a line) —
// but if left in, its content still gets swept into whichever application
// block precedes it (see splitIntoMessageSegments' doc comment) instead of
// being dropped. Filtering per-message *before* reconstruction, rather than
// filtering parsed Applications after the fact, is what actually stops that
// bleed-through: by the time parseApplications runs, the chatter's lines are
// already merged into the previous block and indistinguishable from it.
function containsBandNameLine(text: string): boolean {
  return normalizeApplicationText(text)
    .split("\n")
    .some((line) => matchBandNameLine(line.trim()) !== null);
}

// Placeholder/example data this app itself suggests in the textarea's
// placeholder text — if an admin's pinned template (or a user who copied it
// without editing) ends up in the export, its band name will match this
// exactly.
const KNOWN_EXAMPLE_BAND_NAMES = ["ヤバい夏合宿さん"];
const TEMPLATE_MARKER_RE = /テンプレ|サンプル|見本|記入例|◯◯|○○|××|＊＊/;

function normalizeForCompare(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, "");
}

// Heuristic stand-in for "have an LLM judge which messages are genuine
// applications" — this project doesn't call any external API (see
// parseBands.ts/parseApplications.ts, which are pure client-side regex/
// heuristic parsers by design), so "noise filtering" here means concrete,
// inspectable rules instead of a model call:
//   - exact matches against known example/dummy band names
//   - band names that look like an unfilled template ("◯◯", "サンプル", ...)
//   - blocks with a バンド名 line but no actual application content at all
//     (an admin's blank template, or a stray mention of "バンド名：" in
//     ordinary chat) — the anchor line matched, but nothing after it did.
// General chatter without any バンド名 line never reaches this function at
// all, since parseApplications only emits a block per anchor match.
export function isNoiseApplication(app: Application): boolean {
  const normalizedName = normalizeForCompare(app.bandName);
  if (KNOWN_EXAMPLE_BAND_NAMES.some((n) => normalizeForCompare(n) === normalizedName)) {
    return true;
  }
  if (TEMPLATE_MARKER_RE.test(app.bandName)) return true;

  const hasAnyContent =
    app.members.length > 0 ||
    app.setlist.length > 0 ||
    app.durationMinutes !== null ||
    app.desiredDateTime.length > 0 ||
    app.hasSync;
  if (!hasAnyContent) return true;

  return false;
}

export type ChatExportParseResult = {
  applications: Application[];
  messageCount: number;
  noiseFilteredCount: number;
};

// Entry point for the batch file-upload flow (see ApplicationImportPanel):
// accepts either a DiscordChatExporter JSON export or a plain-text export/
// paste, extracts every band application it can find, and drops anything
// that looks like noise (see isNoiseApplication) before returning.
export function parseChatExportFile(fileText: string, fileName: string): ChatExportParseResult {
  const looksLikeJson = fileName.toLowerCase().endsWith(".json") || /^\s*[{[]/.test(fileText);

  let messageCount: number;
  let candidates: Application[];

  if (looksLikeJson) {
    let data: unknown;
    try {
      data = JSON.parse(fileText);
    } catch {
      throw new Error("JSONファイルとして読み込めませんでした。ファイル形式を確認してください");
    }
    if (!isDiscordExportJson(data)) {
      throw new Error(
        "DiscordChatExporterのJSON形式（messages配列を含む）ではないようです",
      );
    }
    const messages = extractDiscordJsonMessages(data);
    messageCount = messages.length;
    const relevant = messages.filter((m) => containsBandNameLine(m.content));
    candidates = parseApplications(buildPseudoChatText(relevant));
  } else {
    const segments = splitIntoMessageSegments(fileText);
    messageCount = segments.length;
    const relevant = segments.filter(containsBandNameLine);
    candidates = parseApplications(relevant.join("\n\n"));
  }

  const applications = candidates.filter((app) => !isNoiseApplication(app));
  return {
    applications,
    messageCount,
    noiseFilteredCount: candidates.length - applications.length,
  };
}
