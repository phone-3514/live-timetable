import { useMemo, useState } from "react";
import type { Application } from "../../types";
import { normalizeMemberName } from "../../utils/normalizeMemberName";
import { Badge } from "./Badge";

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

function MemberBadgeList({ members }: { members: Application["members"] }) {
  return (
    <ul className="space-y-1">
      {members.map((m, i) => (
        <li key={i} className="flex flex-wrap items-center gap-1">
          {m.grade && <Badge tone="grade">{m.grade}</Badge>}
          {m.part && <Badge tone="part">{m.part}</Badge>}
          <span className="text-slate-200">{m.name}</span>
        </li>
      ))}
    </ul>
  );
}

function SetlistLines({ setlist }: { setlist: Application["setlist"] }) {
  return (
    <ul className="space-y-0.5">
      {setlist.map((s, i) => (
        <li key={i}>
          {s.title}
          {s.artist ? ` / ${s.artist}` : ""}
        </li>
      ))}
    </ul>
  );
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
    // Member names are matched name-normalized (see normalizeMemberName) so
    // clicking a member chip — or just typing their name with different
    // spacing than a particular application recorded — still finds every
    // band they're in, not only the ones spelled exactly like the query.
    const normalizedQuery = normalizeMemberName(q);
    return applications.filter((a) => {
      const memberTextMatch = a.members
        .map((m) => m.name)
        .join(" ")
        .toLowerCase()
        .includes(q);
      const memberNormalizedMatch = a.members.some((m) =>
        normalizeMemberName(m.name).toLowerCase().includes(normalizedQuery),
      );
      return (
        a.bandName.toLowerCase().includes(q) ||
        a.applicantName.toLowerCase().includes(q) ||
        memberTextMatch ||
        memberNormalizedMatch ||
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
    <div className="flex flex-1 flex-col gap-2 md:min-h-0">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <input
          type="text"
          value={filterText}
          onChange={(e) => onFilterTextChange(e.target.value)}
          placeholder="バンド名・申請者・メンバー名・希望日時で絞り込み"
          className="min-h-11 w-full max-w-sm rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-500 md:min-h-0"
        />
        {filterText && (
          <button
            type="button"
            onClick={() => onFilterTextChange("")}
            className="min-h-11 rounded border border-slate-600 px-3 text-[11px] text-slate-300 hover:bg-slate-800 md:min-h-0 md:py-1"
          >
            絞り込みを解除
          </button>
        )}
        <span className="text-xs text-slate-500">{sorted.length}件</span>
      </div>

      {sorted.length === 0 && (
        <p className="rounded-lg border border-slate-700 px-3 py-6 text-center text-sm text-slate-500">
          該当する申し込みがありません
        </p>
      )}

      {/* Mobile (<768px): one card per application instead of a table row —
          a 9-column table has no room to stay legible once each column
          drops to ~35px on a 320px screen, so this is a different layout,
          not just the same table squeezed down. */}
      {sorted.length > 0 && (
        <div className="flex flex-col gap-2 overflow-y-auto md:hidden">
          {sorted.map((app) => (
            <div
              key={app.id}
              className={`rounded-lg border p-3 ${
                app.approved
                  ? "border-emerald-700 bg-emerald-950/20"
                  : "border-slate-700 bg-slate-800"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-slate-100">
                    {app.bandName}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-400">
                    {app.applicantName || "-"} ・ {app.applicationDateTime || "-"}
                  </p>
                </div>
                <Badge
                  tone={app.approved ? "status-approved" : "status-pending"}
                  className="shrink-0"
                >
                  {app.approved ? "承認済み" : "未承認"}
                </Badge>
              </div>

              {app.parseWarning && (
                <p className="mt-1.5 text-xs text-amber-400">⚠ {app.parseWarning}</p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge tone={app.hasSync ? "sync-on" : "sync-off"}>
                  同期{app.hasSync ? "あり" : "なし"}
                </Badge>
                {app.durationMinutes != null && (
                  <span className="text-xs text-slate-300">{app.durationMinutes}分</span>
                )}
                {app.desiredDateTime && (
                  <span className="text-xs text-slate-300">・{app.desiredDateTime}</span>
                )}
              </div>

              {app.setlist.length > 0 && (
                <div className="mt-2 text-xs text-slate-300">
                  <p className="mb-0.5 font-semibold text-slate-500">セットリスト</p>
                  <SetlistLines setlist={app.setlist} />
                </div>
              )}

              {app.members.length > 0 && (
                <div className="mt-2 text-xs">
                  <p className="mb-1 font-semibold text-slate-500">メンバー</p>
                  <MemberBadgeList members={app.members} />
                </div>
              )}

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => (app.approved ? onUnapprove(app.id) : onApprove(app.id))}
                  className={`min-h-11 flex-1 rounded-md text-sm font-semibold ${
                    app.approved
                      ? "border border-emerald-600 bg-emerald-900/40 text-emerald-200"
                      : "bg-emerald-600 text-white hover:bg-emerald-500"
                  }`}
                >
                  {app.approved ? "✓ キャンセル" : "承認"}
                </button>
                <button
                  type="button"
                  onClick={() => onRequestReject(app)}
                  className="min-h-11 flex-1 rounded-md border-2 border-red-600 text-sm font-semibold text-red-400 hover:bg-red-950/50"
                >
                  却下
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Desktop/tablet (≥768px): dense sortable table. */}
      {sorted.length > 0 && (
        <div className="hidden min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-lg border border-slate-700 md:block">
          <table className="w-full table-fixed border-collapse text-xs">
            <colgroup>
              <col className="w-[11%]" />
              <col className="w-[11%]" />
              <col className="w-[11%]" />
              <col className="w-[17%]" />
              <col className="w-[17%]" />
              <col className="w-[6%]" />
              <col className="w-[7%]" />
              <col className="w-[9%]" />
              {/* Wider than a naive 7% share would suggest — at the table's
                  own md:768px cutoff there's little room left, and 承認/却下
                  wrap into cramped single-character lines below ~60px. */}
              <col className="w-[11%]" />
            </colgroup>
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
                  <td className="break-words px-2 py-1.5 text-slate-300">
                    {app.applicantName || "-"}
                  </td>
                  <td className="break-words px-2 py-1.5 text-slate-300">
                    {app.applicationDateTime || "-"}
                  </td>
                  <td className="break-words px-2 py-1.5 font-medium text-slate-100">
                    {app.bandName}
                    {app.parseWarning && (
                      <p className="mt-0.5 text-[10px] font-normal text-amber-400">
                        ⚠ {app.parseWarning}
                      </p>
                    )}
                  </td>
                  <td className="break-words px-2 py-1.5 text-slate-300">
                    <SetlistLines setlist={app.setlist} />
                  </td>
                  <td className="break-words px-2 py-1.5 text-slate-300">
                    <MemberBadgeList members={app.members} />
                  </td>
                  <td className="break-words px-2 py-1.5">
                    <Badge tone={app.hasSync ? "sync-on" : "sync-off"}>
                      {app.hasSync ? "あり" : "なし"}
                    </Badge>
                  </td>
                  <td className="break-words px-2 py-1.5 text-slate-300">
                    {app.durationMinutes != null ? `${app.durationMinutes}分` : "-"}
                  </td>
                  <td className="break-words px-2 py-1.5 text-slate-300">
                    {app.desiredDateTime || "-"}
                  </td>
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
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
