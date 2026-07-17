import { useMemo, useState } from "react";
import type { Application } from "../../types";

type SortKey =
  | "applicantName"
  | "applicationDateTime"
  | "bandName"
  | "durationMinutes"
  | "desiredDateTime"
  | "hasSync"
  | "memberCount";
type SortDir = "asc" | "desc";

interface Props {
  applications: Application[];
  onApprove: (id: string) => void;
  onUnapprove: (id: string) => void;
  onRequestReject: (app: Application) => void;
  filterText: string;
  onFilterTextChange: (text: string) => void;
}

function memberLabel(m: Application["members"][number]): string {
  const prefix = [m.grade, m.part].filter(Boolean).join(" ");
  return prefix ? `${prefix} ${m.name}` : m.name;
}

export function ApplicationTable({
  applications,
  onApprove,
  onUnapprove,
  onRequestReject,
  filterText,
  onFilterTextChange,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("applicationDateTime");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return applications;
    return applications.filter((a) => {
      const memberNames = a.members.map((m) => m.name).join(" ").toLowerCase();
      return (
        a.bandName.toLowerCase().includes(q) ||
        a.applicantName.toLowerCase().includes(q) ||
        memberNames.includes(q) ||
        a.desiredDateTime.toLowerCase().includes(q)
      );
    });
  }, [applications, filterText]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "applicantName":
          cmp = a.applicantName.localeCompare(b.applicantName, "ja");
          break;
        case "applicationDateTime":
          cmp = a.applicationDateTime.localeCompare(b.applicationDateTime, "ja");
          break;
        case "bandName":
          cmp = a.bandName.localeCompare(b.bandName, "ja");
          break;
        case "durationMinutes":
          cmp = (a.durationMinutes ?? -1) - (b.durationMinutes ?? -1);
          break;
        case "desiredDateTime":
          cmp = a.desiredDateTime.localeCompare(b.desiredDateTime, "ja");
          break;
        case "hasSync":
          cmp = Number(a.hasSync) - Number(b.hasSync);
          break;
        case "memberCount":
          cmp = a.members.length - b.members.length;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function sortIndicator(key: SortKey) {
    if (key !== sortKey) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  const headerClass =
    "cursor-pointer select-none whitespace-nowrap px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-200";
  const plainHeaderClass =
    "px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-2">
        <input
          type="text"
          value={filterText}
          onChange={(e) => onFilterTextChange(e.target.value)}
          placeholder="バンド名・申請者・メンバー名・希望日時で絞り込み"
          className="w-full max-w-sm rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-500"
        />
        {filterText && (
          <button
            type="button"
            onClick={() => onFilterTextChange("")}
            className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
          >
            絞り込みを解除
          </button>
        )}
        <span className="text-xs text-slate-500">{sorted.length}件</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-700">
        <table className="w-full min-w-max border-collapse text-xs">
          <thead className="sticky top-0 border-b border-slate-700 bg-slate-900">
            <tr>
              <th className={headerClass} onClick={() => toggleSort("applicantName")}>
                申請者氏名{sortIndicator("applicantName")}
              </th>
              <th className={headerClass} onClick={() => toggleSort("applicationDateTime")}>
                申請日時{sortIndicator("applicationDateTime")}
              </th>
              <th className={headerClass} onClick={() => toggleSort("bandName")}>
                バンド名{sortIndicator("bandName")}
              </th>
              <th className={plainHeaderClass}>セットリスト</th>
              <th className={plainHeaderClass}>メンバー</th>
              <th className={headerClass} onClick={() => toggleSort("hasSync")}>
                同期{sortIndicator("hasSync")}
              </th>
              <th className={headerClass} onClick={() => toggleSort("durationMinutes")}>
                演奏時間{sortIndicator("durationMinutes")}
              </th>
              <th className={headerClass} onClick={() => toggleSort("desiredDateTime")}>
                出演希望日{sortIndicator("desiredDateTime")}
              </th>
              <th className={plainHeaderClass}>状態</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((app) => (
              <tr
                key={app.id}
                className={`border-b border-slate-800 last:border-0 ${
                  app.approved ? "bg-emerald-950/20" : ""
                }`}
              >
                <td className="px-2 py-1.5 text-slate-300">{app.applicantName || "-"}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-slate-300">
                  {app.applicationDateTime || "-"}
                </td>
                <td className="px-2 py-1.5 font-medium text-slate-100">
                  {app.bandName}
                  {app.parseWarning && (
                    <p className="mt-0.5 text-[10px] font-normal text-amber-400">
                      ⚠ {app.parseWarning}
                    </p>
                  )}
                </td>
                <td className="px-2 py-1.5 text-slate-300">
                  <ul className="space-y-0.5">
                    {app.setlist.map((s, i) => (
                      <li key={i}>
                        {s.title}
                        {s.artist ? ` / ${s.artist}` : ""}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="px-2 py-1.5 text-slate-300">
                  <ul className="space-y-0.5">
                    {app.members.map((m, i) => (
                      <li key={i}>{memberLabel(m)}</li>
                    ))}
                  </ul>
                </td>
                <td className="px-2 py-1.5 text-slate-300">{app.hasSync ? "あり" : "なし"}</td>
                <td className="px-2 py-1.5 text-slate-300">
                  {app.durationMinutes != null ? `${app.durationMinutes}分` : "-"}
                </td>
                <td className="px-2 py-1.5 text-slate-300">{app.desiredDateTime || "-"}</td>
                <td className="px-2 py-1.5">
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        app.approved ? onUnapprove(app.id) : onApprove(app.id)
                      }
                      className={
                        app.approved
                          ? "rounded border border-emerald-700 bg-emerald-900/40 px-2 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-900/70"
                          : "rounded border border-slate-600 px-2 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-800"
                      }
                    >
                      {app.approved ? "✓ キャンセル" : "承認"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRequestReject(app)}
                      className="rounded border border-red-800 px-2 py-1 text-[11px] font-medium text-red-400 hover:bg-red-950/40"
                    >
                      却下
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-500">
                  該当する申し込みがありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
