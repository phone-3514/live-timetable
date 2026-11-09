import type { Application } from "../types";
import type { ClosingCandidate } from "./closingCandidates";
import { resolveBandDetail } from "./setlistExport";
import { downloadFile } from "./shareOrDownload";

// トリ候補をExcel(.xlsx)にする。置ける候補（OK→注意）を先に、置けないバンドを後に、
// 1シートにまとめる。メンバー・セットリスト・指定・理由つき。exceljs は大きいので、
// ボタンを押したときだけ読み込む。

const HEADER_FILL = "FF1E293B";
const HEADER_TEXT = "FFFFFFFF";
const BORDER_COLOR = "FFCBD5E1";
const STATUS_FILL = { ok: "FFDCFCE7", warn: "FFFEF3C7", excluded: "FFFEE2E2" } as const;
const STATUS_LABEL = { ok: "OK", warn: "注意", excluded: "不可" } as const;

export type ClosingExportInput = {
  dayLabel: string;
  slotLabel: string;
  slotTime: string;
  currentBandName: string | null;
  candidates: ClosingCandidate[];
  applications: Application[];
};

export function closingExcelFilename(input: Pick<ClosingExportInput, "dayLabel" | "slotLabel">): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|（）()\s]+/g, "");
  return `トリ候補_${clean(input.dayLabel)}_${clean(input.slotLabel)}.xlsx`;
}

export async function buildClosingCandidatesXlsx(input: ClosingExportInput): Promise<ArrayBuffer> {
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

  const sheet = workbook.addWorksheet("トリ候補", { views: [{ state: "frozen", ySplit: 1, xSplit: 2 }] });
  sheet.columns = [
    { header: "区分", key: "status", width: 7 },
    { header: "バンド名", key: "band", width: 24 },
    { header: "ライブ構成評価", key: "rating", width: 9 },
    { header: "現在の配置", key: "placement", width: 20 },
    { header: "演奏時間(分)", key: "minutes", width: 10 },
    { header: "メンバー", key: "members", width: 36 },
    { header: "セットリスト", key: "setlist", width: 40 },
    { header: "出演希望日", key: "desired", width: 22 },
    { header: "NG時間", key: "ng", width: 22 },
    { header: "時間指定の理由メモ", key: "note", width: 28 },
    { header: "注意", key: "warnings", width: 44 },
    { header: "置けない理由", key: "blockers", width: 40 },
  ];
  const header = sheet.getRow(1);
  header.height = 24;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_TEXT } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = border;
  });

  for (const c of input.candidates) {
    const { songs, members } = resolveBandDetail(c.band, input.applications);
    const row = sheet.addRow({
      status: STATUS_LABEL[c.status],
      band: c.isCurrentClosing ? `${c.band.name}（現在のトリ）` : c.band.name,
      rating: c.rating,
      placement: c.placement ? `${c.placement.dayLabel} ${c.placement.startTime}` : c.isCurrentClosing ? "（この枠）" : "未配置",
      minutes: c.band.durationMinutes ?? "",
      members: members
        .map((m) => `${m.name}${m.part || m.grade ? `（${[m.part, m.grade].filter(Boolean).join(" / ")}）` : ""}`)
        .join("\n"),
      setlist: songs.map((s, i) => `${i + 1}. ${s.artist ? `${s.title} / ${s.artist}` : s.title}`).join("\n"),
      desired: c.band.desiredTime.trim(),
      ng: c.band.ngTime.trim(),
      note: (c.band.timeReasonNote ?? "").trim(),
      warnings: c.warnings.join("\n"),
      blockers: c.blockers.join("\n"),
    });
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = { vertical: "top", horizontal: "left", wrapText: true };
      cell.border = border;
    });
    const statusCell = row.getCell("status");
    statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STATUS_FILL[c.status] } };
    statusCell.font = { bold: true };
    statusCell.alignment = { vertical: "top", horizontal: "center" };
  }

  const ok = input.candidates.filter((c) => c.status === "ok").length;
  const warn = input.candidates.filter((c) => c.status === "warn").length;
  const excluded = input.candidates.filter((c) => c.status === "excluded").length;
  sheet.addRow([]);
  const summary = sheet.addRow([
    `${input.dayLabel} ${input.slotLabel} ${input.slotTime} ／ 現在: ${input.currentBandName ?? "未配置"} ／ 全${input.candidates.length}バンド（OK ${ok}・注意 ${warn}・不可 ${excluded}）`,
  ]);
  summary.getCell(1).font = { bold: true };

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function downloadClosingCandidatesExcel(input: ClosingExportInput): Promise<void> {
  const buffer = await buildClosingCandidatesXlsx(input);
  await downloadFile(
    new File([buffer], closingExcelFilename(input), {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
}
