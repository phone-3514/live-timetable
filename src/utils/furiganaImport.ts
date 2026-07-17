export type FuriganaImportEntry = { name: string; furigana: string };
export type FuriganaImportResult = {
  entries: FuriganaImportEntry[];
  matchedCount: number;
  skippedCount: number;
};

const NAME_HEADER_ALIASES = ["氏名", "名前", "name", "氏名（フルネーム）"];
const FURIGANA_HEADER_ALIASES = ["ふりがな", "フリガナ", "かな", "カナ", "furigana"];

function splitDelimited(line: string): string[] {
  // Master sheets are pasted from Excel/Sheets (tab-delimited) or exported
  // as CSV (comma-delimited) — this repo has no dependency for quoted-CSV
  // parsing, and a master roster's 氏名/ふりがな columns are never going to
  // contain a literal comma, so a plain split is enough for the two columns
  // this function is allowed to read in the first place.
  return line.includes("\t") ? line.split("\t") : line.split(",");
}

// Extracts ONLY the 氏名 (name) and ふりがな (furigana) columns from a
// pasted or uploaded master roster, by header name — every other column
// (address, phone number, email, etc., however many the source sheet has)
// is never read into a variable at all, so it cannot leak into app state,
// localStorage, or anywhere else downstream of this function. This is a
// hard privacy boundary: if new fields are ever needed from the master
// sheet, they must be added here explicitly and deliberately, never by
// widening what this function returns.
export function parseFuriganaMasterData(rawText: string): FuriganaImportResult {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return { entries: [], matchedCount: 0, skippedCount: 0 };
  }

  const header = splitDelimited(lines[0]).map((h) => h.trim());
  const nameIdx = header.findIndex((h) => NAME_HEADER_ALIASES.includes(h));
  const furiganaIdx = header.findIndex((h) => FURIGANA_HEADER_ALIASES.includes(h));

  if (nameIdx === -1 || furiganaIdx === -1) {
    throw new Error(
      "「氏名」列と「ふりがな」列が見つかりませんでした。1行目に見出し行を含めてください。",
    );
  }

  const entries: FuriganaImportEntry[] = [];
  let skippedCount = 0;
  for (const line of lines.slice(1)) {
    const cells = splitDelimited(line);
    const name = cells[nameIdx]?.trim() ?? "";
    const furigana = cells[furiganaIdx]?.trim() ?? "";
    if (!name || !furigana) {
      skippedCount++;
      continue;
    }
    entries.push({ name, furigana });
  }
  return { entries, matchedCount: entries.length, skippedCount };
}
