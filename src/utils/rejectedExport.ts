import type { Application } from "../types";
import { downloadFile } from "./shareOrDownload";
import { computeMemberImpacts, describeBandImpact } from "./rejectionImpact";
import { normalizeMemberName } from "./normalizeMemberName";

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

export function buildRejectedCsv(apps: Application[], remaining: Application[] = []): string {
  const impacts = computeMemberImpacts(remaining, apps);
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
    "枠数の変動（却下前→却下後）",
    "出演枠がなくなった人",
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
    describeBandImpact(app, impacts).join(" / "),
    app.members
      .map((m) => impacts.get(normalizeMemberName(m.name)))
      .filter((i): i is NonNullable<typeof i> => !!i && i.now === 0)
      .map((i) => i.name)
      .filter((name, index, all) => all.indexOf(name) === index)
      .join("、"),
  ]);

  // Below the bands: one line per affected person, so "who ended up with no
  // slot" and "who lost how many" can be read at a glance.
  const people = [...impacts.values()].sort(
    (a, b) => Number(a.now > 0) - Number(b.now > 0) || a.name.localeCompare(b.name, "ja"),
  );
  const peopleHeader = ["【人別の枠数の変化】", "却下前", "現在", "減った枠数", "却下されたバンド", "出演枠"];
  const peopleRows = people.map((p) => [
    p.name,
    `${p.before}枠`,
    `${p.now}枠`,
    String(p.before - p.now),
    p.rejectedBands.join(" / "),
    p.now === 0 ? "なし（0枠）" : "あり",
  ]);
  const zeroCount = people.filter((p) => p.now === 0).length;
  const summary = [`【集計】却下 ${apps.length}組 / 影響を受けた人 ${people.length}人 / 出演枠が0になった人 ${zeroCount}人`];

  return (
    "\uFEFF" +
    [header, ...rows, [], summary, peopleHeader, ...peopleRows]
      .map((r) => r.map(cell).join(","))
      .join("\r\n") +
    "\r\n"
  );
}

export function rejectedCsvFilename(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `却下済みバンド_${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}.csv`;
}

export async function downloadRejectedCsv(apps: Application[], remaining: Application[]): Promise<void> {
  await downloadFile(
    new File([buildRejectedCsv(apps, remaining)], rejectedCsvFilename(), { type: "text/csv;charset=utf-8" }),
  );
}
