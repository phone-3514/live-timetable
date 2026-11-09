import type { Band, TimetableDay, TimetableSlot } from "../types";
import type { EventInfo } from "../store/useAppStore";
import { downloadFile } from "./shareOrDownload";
import { isHiddenBlock } from "./slotKinds";

// 全日程のタイムテーブルをExcel(.xlsx)にする — 共有用画像(ShareAllDaysTemplate)と
// 同じ内容: 画像に載る行(バンドの出番と、休憩などの非演奏行)だけを時刻順に、
// 非表示の余白と空き枠は除く。メンバー・ライブ構成評価・時間指定のメモなど、画像に
// 出さない運営用の情報は入れない。セットリストは画像のように曲数で切らず全曲。
// 先頭のシート「全日程」は全日を1つの表に、続けて日ごとのシート。exceljs は大きいので
// ボタンを押したときだけ読み込む。

const HEADER_FILL = "FF1E293B";
const HEADER_TEXT = "FFFFFFFF";
const BORDER_COLOR = "FFCBD5E1";
const BREAK_FILL = "FFF1F5F9";

export type TimetableRow = {
  /** 出番の通し番号(その日のバンドだけを数える)。非演奏行は null。 */
  order: number | null;
  startTime: string;
  endTime: string;
  /** バンド名、または休憩などの項目名。 */
  title: string;
  isBand: boolean;
  hasSync: boolean;
  hasKeyboard: boolean;
  setlist: string[];
};

export function buildDayRows(day: TimetableDay, bands: Band[]): TimetableRow[] {
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const rows: TimetableRow[] = [];
  let order = 0;
  for (const slot of day.slots as TimetableSlot[]) {
    if (isHiddenBlock(slot)) continue;
    const band = slot.bandId ? bandMap.get(slot.bandId) : undefined;
    if (band) {
      rows.push({
        order: ++order,
        startTime: slot.startTime,
        endTime: slot.endTime,
        title: band.name,
        isBand: true,
        hasSync: band.hasSync,
        hasKeyboard: band.hasKeyboard,
        setlist: band.setlist,
      });
    } else if (slot.customLabel !== null) {
      rows.push({
        order: null,
        startTime: slot.startTime,
        endTime: slot.endTime,
        title: slot.customLabel,
        isBand: false,
        hasSync: false,
        hasKeyboard: false,
        setlist: [],
      });
    }
  }
  return rows;
}

function formatSong(song: string, index: number): string {
  const slash = song.indexOf("/");
  const title = slash === -1 ? song : song.slice(0, slash);
  const artist = slash === -1 ? "" : song.slice(slash + 1).trim();
  return `${index + 1}. ${title.trim()}${artist ? ` - ${artist}` : ""}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(d);
}

// Excel sheet names: <= 31 chars, none of  \ / ? * [ ] :  — and unique.
function sheetName(label: string, taken: Set<string>): string {
  const base = (label.replace(/[\\/?*[\]:]/g, "").trim() || "日程").slice(0, 28);
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}(${n})`;
  taken.add(name);
  return name;
}

export function timetableExcelFilename(eventInfo: EventInfo): string {
  const name = eventInfo.liveName.replace(/[\\/:*?"<>|\s]+/g, "");
  return `タイムテーブル_${name || "全日程"}.xlsx`;
}

export async function buildTimetableXlsx(days: TimetableDay[], bands: Band[], eventInfo: EventInfo): Promise<ArrayBuffer> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = eventInfo.organizationName || "軽音ライブ タイムテーブル作成";
  workbook.created = new Date();

  const border = {
    top: { style: "thin" as const, color: { argb: BORDER_COLOR } },
    bottom: { style: "thin" as const, color: { argb: BORDER_COLOR } },
    left: { style: "thin" as const, color: { argb: BORDER_COLOR } },
    right: { style: "thin" as const, color: { argb: BORDER_COLOR } },
  };

  function addSheet(name: string, withDay: boolean, parts: { day: TimetableDay; rows: TimetableRow[] }[]) {
    const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = [
      ...(withDay
        ? [
            { header: "日程", key: "day", width: 12 },
            { header: "日付", key: "date", width: 18 },
          ]
        : []),
      { header: "No.", key: "order", width: 6 },
      { header: "開始", key: "start", width: 8 },
      { header: "終了", key: "end", width: 8 },
      { header: "バンド / 項目", key: "title", width: 30 },
      { header: "SYNC", key: "sync", width: 7 },
      { header: "KEY", key: "key", width: 7 },
      { header: "セットリスト", key: "setlist", width: 50 },
    ];
    const header = sheet.getRow(1);
    header.height = 24;
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: HEADER_TEXT } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = border;
    });
    for (const { day, rows } of parts) {
      for (const r of rows) {
        const row = sheet.addRow({
          day: day.label,
          date: formatDate(day.date),
          order: r.order ?? "",
          start: r.startTime,
          end: r.endTime,
          title: r.title,
          sync: r.hasSync ? "SYNC" : "",
          key: r.hasKeyboard ? "KEY" : "",
          setlist: r.setlist.map(formatSong).join("\n"),
        });
        row.eachCell({ includeEmpty: true }, (cell) => {
          cell.alignment = { vertical: "top", horizontal: "left", wrapText: true };
          cell.border = border;
          if (!r.isBand) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BREAK_FILL } };
        });
        row.getCell("title").font = { bold: true };
        row.getCell("order").alignment = { vertical: "top", horizontal: "center" };
        row.getCell("sync").alignment = { vertical: "top", horizontal: "center" };
        row.getCell("key").alignment = { vertical: "top", horizontal: "center" };
      }
    }
    return sheet;
  }

  const parts = days.map((day) => ({ day, rows: buildDayRows(day, bands) }));
  const taken = new Set<string>();
  const all = addSheet(sheetName("全日程", taken), true, parts);
  const title = eventInfo.liveName || days.map((d) => d.label).join(" ・ ");
  all.addRow([]);
  all.addRow([[title, eventInfo.venue, eventInfo.organizationName].filter(Boolean).join(" ／ ")]).getCell(1).font = {
    bold: true,
  };
  for (const part of parts) addSheet(sheetName(part.day.label, taken), false, [part]);

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function downloadTimetableExcel(days: TimetableDay[], bands: Band[], eventInfo: EventInfo): Promise<void> {
  const buffer = await buildTimetableXlsx(days, bands, eventInfo);
  await downloadFile(
    new File([buffer], timetableExcelFilename(eventInfo), {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
}
