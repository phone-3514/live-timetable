import type { Application } from "../types";
import { downloadFile } from "./shareOrDownload";
import { computeMemberImpacts, describeBandImpact } from "./rejectionImpact";
import { normalizeMemberName } from "./normalizeMemberName";

// 却下済みのバンドをExcel(.xlsx)にする。シート1は却下したバンドごと（理由と、
// メンバーの枠数の変動つき）、シート2は人別の枠数の変化（0枠になった人が先頭）。
// exceljs は大きいので、ボタンを押したときだけ読み込む。

const HEADER_FILL = "FF1E293B";
const HEADER_TEXT = "FFFFFFFF";
const BORDER_COLOR = "FFCBD5E1";
const ALERT_FILL = "FFFEE2E2";
const ALERT_TEXT = "FFB91C1C";

function formatDateTime(ms: number | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function rejectedExcelFilename(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `却下済みバンド_${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}.xlsx`;
}

export async function buildRejectedXlsx(apps: Application[], remaining: Application[]): Promise<ArrayBuffer> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "軽音ライブ タイムテーブル作成";
  workbook.created = new Date();
  const impacts = computeMemberImpacts(remaining, apps);

  const border = {
    top: { style: "thin" as const, color: { argb: BORDER_COLOR } },
    bottom: { style: "thin" as const, color: { argb: BORDER_COLOR } },
    left: { style: "thin" as const, color: { argb: BORDER_COLOR } },
    right: { style: "thin" as const, color: { argb: BORDER_COLOR } },
  };
  const styleHeader = (sheet: import("exceljs").Worksheet) => {
    const row = sheet.getRow(1);
    row.height = 24;
    row.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: HEADER_TEXT } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = border;
    });
  };
  const styleBody = (row: import("exceljs").Row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = { vertical: "top", horizontal: "left", wrapText: true };
      cell.border = border;
    });
  };
  const highlight = (cell: import("exceljs").Cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ALERT_FILL } };
    cell.font = { bold: true, color: { argb: ALERT_TEXT } };
  };

  // Sheet 1: the rejected bands.
  const bands = workbook.addWorksheet("却下したバンド", { views: [{ state: "frozen", ySplit: 1, xSplit: 1 }] });
  bands.columns = [
    { header: "バンド名", key: "band", width: 24 },
    { header: "申請者", key: "applicant", width: 14 },
    { header: "申請日時", key: "appliedAt", width: 18 },
    { header: "出演希望日", key: "desired", width: 22 },
    { header: "時間指定の理由メモ", key: "note", width: 30 },
    { header: "演奏時間(分)", key: "minutes", width: 10 },
    { header: "同期", key: "sync", width: 7 },
    { header: "メンバー", key: "members", width: 36 },
    { header: "セットリスト", key: "setlist", width: 36 },
    { header: "却下日時", key: "rejectedAt", width: 18 },
    { header: "却下理由", key: "reason", width: 44 },
    { header: "枠数の変動（却下前→却下後）", key: "impact", width: 40 },
    { header: "出演枠がなくなった人", key: "zeroed", width: 22 },
  ];
  styleHeader(bands);
  for (const app of apps) {
    const zeroed = app.members
      .map((m) => impacts.get(normalizeMemberName(m.name)))
      .filter((i): i is NonNullable<typeof i> => !!i && i.now === 0)
      .map((i) => i.name)
      .filter((name, index, all) => all.indexOf(name) === index);
    const row = bands.addRow({
      band: app.bandName,
      applicant: app.applicantName,
      appliedAt: app.applicationDateTime,
      desired: app.desiredDateTime,
      note: app.timeReasonNote ?? "",
      minutes: app.durationMinutes ?? "",
      sync: app.hasSync ? "あり" : "なし",
      members: app.members
        .map((m) => [m.grade, m.part, m.name, m.frameOrdinal != null ? `${m.frameOrdinal}枠目` : ""].filter(Boolean).join(" "))
        .join("\n"),
      setlist: app.setlist.map((s) => (s.artist ? `${s.title} / ${s.artist}` : s.title)).join("\n"),
      rejectedAt: formatDateTime(app.rejectedAt),
      reason: app.rejectionReason ?? "",
      impact: describeBandImpact(app, impacts).join("\n"),
      zeroed: zeroed.join("、"),
    });
    styleBody(row);
    if (zeroed.length > 0) highlight(row.getCell("zeroed"));
  }

  // Sheet 2: per person.
  const people = [...impacts.values()].sort(
    (a, b) => Number(a.now > 0) - Number(b.now > 0) || a.name.localeCompare(b.name, "ja"),
  );
  const sheet = workbook.addWorksheet("人別の枠数の変化", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "名前", key: "name", width: 20 },
    { header: "却下前の枠数", key: "before", width: 12 },
    { header: "現在の枠数", key: "now", width: 12 },
    { header: "減った枠数", key: "lost", width: 12 },
    { header: "却下されたバンド", key: "bands", width: 44 },
    { header: "出演枠", key: "status", width: 14 },
  ];
  styleHeader(sheet);
  for (const p of people) {
    const row = sheet.addRow({
      name: p.name,
      before: p.before,
      now: p.now,
      lost: p.before - p.now,
      bands: p.rejectedBands.join("\n"),
      status: p.now === 0 ? "なし（0枠）" : "あり",
    });
    styleBody(row);
    if (p.now === 0) row.eachCell((cell) => highlight(cell));
  }
  const zeroCount = people.filter((p) => p.now === 0).length;
  sheet.addRow([]);
  const summary = sheet.addRow([
    `却下 ${apps.length}組 / 影響を受けた人 ${people.length}人 / 出演枠が0になった人 ${zeroCount}人`,
  ]);
  summary.getCell(1).font = { bold: true };

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function downloadRejectedExcel(apps: Application[], remaining: Application[]): Promise<void> {
  const buffer = await buildRejectedXlsx(apps, remaining);
  await downloadFile(
    new File([buffer], rejectedExcelFilename(), {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
}
