import type { Application, Band, TimetableDay } from "../types";
import { downloadFile } from "./shareOrDownload";
import { resolveBandDetail, type SetlistMemberEntry } from "./setlistExport";

// 全バンドのメンバー情報をExcel(.xlsx)にする(配置の有無を問わず全バンド。並びは
// タイムテーブルの順で、未配置は最後)。メンバーは「学年 パート 名前」の順で書く(空の項目は詰める)。メンバー
// 情報の元は、セットリスト出力と同じ resolveBandDetail — バンド自身の memberDetails、
// 無ければ紐づく申請のメンバー、それも無ければ名前だけ。
// シート1「バンド別」は1バンド1行(メンバーはセル内改行)、シート2「メンバー一覧」は
// 1人1行(絞り込み・並べ替え用)。exceljs は大きいので、ボタンを押したときだけ読み込む。

const HEADER_FILL = "FF1E293B";
const HEADER_TEXT = "FFFFFFFF";
const BORDER_COLOR = "FFCBD5E1";

/** "3年 Gt 山田太郎" — 学年・パートが空ならその分を詰める。 */
export function formatMemberLabel(m: SetlistMemberEntry): string {
  return [m.grade, m.part, m.name].map((v) => v.trim()).filter(Boolean).join(" ");
}

function placementLabel(band: Band, days: TimetableDay[]): string {
  for (const day of days) {
    const slot = day.slots.find((s) => s.bandId === band.id && s.customLabel === null);
    if (slot) return `${day.label} ${slot.startTime}${slot.endTime ? `-${slot.endTime}` : ""}`;
  }
  return "未配置";
}

/** タイムテーブルの順 — 日程の順、各日の出番の順に並べ、未配置のバンドは最後(元の順)。 */
export function orderBandsByTimetable(bands: Band[], days: TimetableDay[]): Band[] {
  const bandById = new Map(bands.map((band) => [band.id, band]));
  const ordered: Band[] = [];
  const seen = new Set<string>();
  for (const day of days) {
    for (const slot of day.slots) {
      if (!slot.bandId || slot.customLabel !== null || seen.has(slot.bandId)) continue;
      const band = bandById.get(slot.bandId);
      if (!band) continue;
      seen.add(band.id);
      ordered.push(band);
    }
  }
  for (const band of bands) if (!seen.has(band.id)) ordered.push(band);
  return ordered;
}

export function bandMembersExcelFilename(): string {
  return "バンドメンバー情報.xlsx";
}

export async function buildBandMembersXlsx(
  bands: Band[],
  applications: Application[],
  days: TimetableDay[],
): Promise<ArrayBuffer> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "軽音ライブ タイムテーブル作成";
  workbook.created = new Date();

  const border = {
    top: { style: "thin" as const, color: { argb: BORDER_COLOR } },
    bottom: { style: "thin" as const, color: { argb: BORDER_COLOR } },
    left: { style: "thin" as const, color: { argb: BORDER_COLOR } },
    right: { style: "thin" as const, color: { argb: BORDER_COLOR } },
  };
  const styleSheet = (sheet: import("exceljs").Worksheet) => {
    const header = sheet.getRow(1);
    header.height = 24;
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: HEADER_TEXT } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = border;
    });
    sheet.eachRow((row, index) => {
      if (index === 1) return;
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.alignment = { vertical: "top", horizontal: "left", wrapText: true };
        cell.border = border;
      });
    });
  };

  const details = orderBandsByTimetable(bands, days).map((band) => ({
    band,
    members: resolveBandDetail(band, applications).members,
  }));

  const byBand = workbook.addWorksheet("バンド別", { views: [{ state: "frozen", ySplit: 1, xSplit: 1 }] });
  byBand.columns = [
    { header: "バンド名", key: "band", width: 28 },
    { header: "出演", key: "placement", width: 20 },
    { header: "人数", key: "count", width: 6 },
    { header: "メンバー（学年 パート 名前）", key: "members", width: 40 },
  ];
  for (const { band, members } of details) {
    byBand.addRow({
      band: band.name,
      placement: placementLabel(band, days),
      count: members.length,
      members: members.length > 0 ? members.map(formatMemberLabel).join("\n") : "（メンバー情報なし）",
    });
  }
  styleSheet(byBand);

  const people = workbook.addWorksheet("メンバー一覧", { views: [{ state: "frozen", ySplit: 1 }] });
  people.columns = [
    { header: "バンド名", key: "band", width: 28 },
    { header: "学年", key: "grade", width: 8 },
    { header: "パート", key: "part", width: 14 },
    { header: "名前", key: "name", width: 20 },
    { header: "学年 パート 名前", key: "label", width: 30 },
  ];
  for (const { band, members } of details) {
    for (const m of members) {
      people.addRow({ band: band.name, grade: m.grade.trim(), part: m.part.trim(), name: m.name.trim(), label: formatMemberLabel(m) });
    }
  }
  styleSheet(people);

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function downloadBandMembersExcel(
  bands: Band[],
  applications: Application[],
  days: TimetableDay[],
): Promise<void> {
  const buffer = await buildBandMembersXlsx(bands, applications, days);
  await downloadFile(
    new File([buffer], bandMembersExcelFilename(), {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
}
