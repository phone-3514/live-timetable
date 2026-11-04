import type { Application } from "../types";
import { downloadFile } from "./shareOrDownload";

// 却下済みのバンドを表計算で開けるCSVにする。先頭にBOMを付けて、Excelでも文字化けしない。

function cell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function formatDateTime(ms: number | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function buildRejectedCsv(apps: Application[]): string {
  const header = [
    "バンド名",
    "申請者",
    "申請日時",
    "出演希望日",
    "時間指定の理由メモ",
    "演奏時間(分)",
    "同期",
    "メンバー",
    "セットリスト",
    "却下日時",
    "却下理由",
  ];
  const rows = apps.map((app) => [
    app.bandName,
    app.applicantName,
    app.applicationDateTime,
    app.desiredDateTime,
    app.timeReasonNote ?? "",
    app.durationMinutes != null ? String(app.durationMinutes) : "",
    app.hasSync ? "あり" : "なし",
    app.members
      .map((m) => [m.grade, m.part, m.name, m.frameOrdinal != null ? `${m.frameOrdinal}枠目` : ""].filter(Boolean).join(" "))
      .join(" / "),
    app.setlist.map((s) => (s.artist ? `${s.title} / ${s.artist}` : s.title)).join(" ／ "),
    formatDateTime(app.rejectedAt),
    app.rejectionReason ?? "",
  ]);
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function rejectedCsvFilename(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `却下済みバンド_${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}.csv`;
}

export async function downloadRejectedCsv(apps: Application[]): Promise<void> {
  await downloadFile(new File([buildRejectedCsv(apps)], rejectedCsvFilename(), { type: "text/csv;charset=utf-8" }));
}
