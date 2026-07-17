import type { Application, Band, TimetableDay } from "../types";
import { normalizeMemberName } from "./normalizeMemberName";

export type RosterEntry = {
  grade: string;
  name: string;
  /** Looked up from useFuriganaStore by normalizeMemberName(name); blank
   * when no imported master sheet has a matching entry. */
  furigana: string;
  /** Every distinct part they perform across all their bands, joined with
   * "、" — a member who sings in one band and plays guitar in another gets
   * both listed, since the roster is used for equipment prep as much as
   * attendance. */
  parts: string;
};

function parseGradeNumber(grade: string): number {
  const m = /(\d+)/.exec(grade);
  return m ? Number(m[1]) : -1;
}

// One row per unique person actually placed on the confirmed timetable
// (not the whole band pool — an unplaced band's members aren't "attending"
// anything yet), deduplicated the same way every other member-facing
// computation in this app is (normalizeMemberName), across every day of
// the event — this is one roster for the whole event, not one per day,
// since staff carry a single sheet. Member data source priority mirrors
// PlacedBandDetailModal/computeSetlistEntries exactly: a band's own
// memberDetails once edited, else its linked Application's members, else
// plain names with blank grade/part.
export function computeMemberRoster(
  days: TimetableDay[],
  bands: Band[],
  applications: Application[],
  furiganaByKey: Record<string, string> = {},
): RosterEntry[] {
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const byMember = new Map<
    string,
    { displayName: string; grade: string; parts: Set<string> }
  >();

  for (const day of days) {
    for (const slot of day.slots) {
      if (!slot.bandId) continue;
      const band = bandMap.get(slot.bandId);
      if (!band) continue;
      const linkedApp = applications.find((a) => a.linkedBandId === band.id);
      const members =
        band.memberDetails && band.memberDetails.length > 0
          ? band.memberDetails
          : linkedApp
            ? linkedApp.members.map((m) => ({ name: m.name, grade: m.grade, part: m.part }))
            : band.members.map((name) => ({ name, grade: "", part: "" }));

      for (const m of members) {
        const key = normalizeMemberName(m.name);
        if (!key) continue;
        const entry = byMember.get(key) ?? { displayName: m.name, grade: "", parts: new Set<string>() };
        // First non-empty grade wins — a person should have one consistent
        // grade, and a stray blank in one band's record shouldn't erase a
        // grade already found via another.
        if (!entry.grade && m.grade) entry.grade = m.grade;
        if (m.part) entry.parts.add(m.part);
        byMember.set(key, entry);
      }
    }
  }

  return [...byMember.entries()]
    .map(([key, e]) => ({
      grade: e.grade,
      name: e.displayName,
      furigana: furiganaByKey[key] ?? "",
      parts: [...e.parts].join("、"),
    }))
    .sort((a, b) => {
      const gradeDiff = parseGradeNumber(b.grade) - parseGradeNumber(a.grade);
      if (gradeDiff !== 0) return gradeDiff;
      return a.name.localeCompare(b.name, "ja");
    });
}

const HEADER_FILL = "FF1E293B"; // slate-800, matches the app's own dark accents
const HEADER_TEXT = "FFF8FAFC"; // slate-50
const ZEBRA_FILL = "FFF1F5F9"; // slate-100
const BORDER_COLOR = "FFCBD5E1"; // slate-300

// Column numbers (1-indexed, matching sheet.columns order below) that get
// a "☐ 未 / ☑ 済" dropdown instead of free text — 受付 and 振り込み確認.
// exceljs has no real checkbox/form-control support, so a constrained
// Data Validation list is the closest equivalent that still lets staff
// tap/click to toggle a value on their phone or in Excel/Sheets, per the
// spec's own "Dropdown with ☑済/☐未" wording.
const CHECKLIST_COLUMN_NUMBERS = new Set([6, 7]);
const CHECKLIST_OPTIONS = ["☐ 未", "☑ 済"];
const CHECKLIST_FORMULA = `"${CHECKLIST_OPTIONS.join(",")}"`;

// Builds the styled roster workbook and triggers a browser download.
// exceljs is dynamically imported here (not at module top level) so it
// only ever loads for someone who actually clicks the export button —
// same reasoning as jsPDF in SetlistExportModal, since exceljs is a
// sizeable dependency that would otherwise bloat the main bundle for
// every visitor who never touches this feature.
export async function downloadMemberRosterExcel(
  entries: RosterEntry[],
  fileName: string,
): Promise<void> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "軽音ライブ タイムテーブル作成";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("参加者名簿", {
    pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = [
    { header: "No.", key: "no", width: 6 },
    { header: "学年", key: "grade", width: 8 },
    { header: "ふりがな", key: "furigana", width: 16 },
    { header: "氏名", key: "name", width: 18 },
    { header: "パート", key: "parts", width: 16 },
    { header: "受付", key: "reception", width: 10 },
    { header: "振り込み確認", key: "paymentCheck", width: 14 },
    { header: "備考", key: "notes", width: 24 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_TEXT } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      top: { style: "thin", color: { argb: BORDER_COLOR } },
      bottom: { style: "thin", color: { argb: BORDER_COLOR } },
      left: { style: "thin", color: { argb: BORDER_COLOR } },
      right: { style: "thin", color: { argb: BORDER_COLOR } },
    };
  });

  entries.forEach((entry, i) => {
    const row = sheet.addRow({
      no: i + 1,
      grade: entry.grade,
      furigana: entry.furigana,
      name: entry.name,
      parts: entry.parts,
      reception: CHECKLIST_OPTIONS[0],
      paymentCheck: CHECKLIST_OPTIONS[0],
      notes: "",
    });
    row.height = 20;
    const isZebra = i % 2 === 1;
    row.eachCell((cell, colNumber) => {
      const isChecklist = CHECKLIST_COLUMN_NUMBERS.has(colNumber);
      cell.alignment = {
        vertical: "middle",
        horizontal: colNumber === 1 || isChecklist ? "center" : "left",
      };
      if (isChecklist) {
        cell.dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [CHECKLIST_FORMULA],
          showErrorMessage: true,
          errorStyle: "warning",
          errorTitle: "入力エラー",
          error: "「☐ 未」または「☑ 済」から選択してください",
        };
      }
      if (isZebra) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA_FILL } };
      }
      cell.border = {
        top: { style: "thin", color: { argb: BORDER_COLOR } },
        bottom: { style: "thin", color: { argb: BORDER_COLOR } },
        left: { style: "thin", color: { argb: BORDER_COLOR } },
        right: { style: "thin", color: { argb: BORDER_COLOR } },
      };
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
