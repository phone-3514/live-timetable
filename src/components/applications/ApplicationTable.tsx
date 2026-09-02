import { useMemo, useState } from "react";
import type { Application } from "../../types";
import { normalizeMemberName } from "../../utils/normalizeMemberName";
import { stripAffiliationNoteForDisplay } from "../../utils/parseBands";
import {
  computeHighParticipation,
  type HighParticipationInfo,
  type MemberFrameCount,
} from "../../store/useApplicationStore";
import { useAppStore } from "../../store/useAppStore";
import { Badge } from "./Badge";
import { ApplicationMobileCard } from "./ApplicationMobileCard";
import { LiveCompositionRatingStars } from "./LiveCompositionRatingStars";
import { PlacedBandDetailModal } from "../PlacedBandDetailModal";

type SortKey =
  | "applicantName"
  | "applicationDateTime"
  | "bandName"
  | "durationMinutes"
  | "desiredDateTime"
  | "hasSync"
  | "memberCount"
  | "highParticipationCount";
type SortDir = "asc" | "desc";

interface Props {
  applications: Application[];
  // Precomputed once by the parent (ApplicationManagerTab, shared with
  // MemberFrameCounts) — see computeHighParticipation below for why this
  // table doesn't rescan every application per band.
  frameCounts: Map<string, MemberFrameCount>;
  onApprove: (id: string) => void;
  onUnapprove: (id: string) => void;
  onRequestReject: (app: Application) => void;
  filterText: string;
  onFilterTextChange: (text: string) => void;
}

export function MemberBadgeList({ members }: { members: Application["members"] }) {
  return (
    <ul className="space-y-1">
      {members.map((m, i) => (
        <li key={i} className="flex flex-wrap items-center gap-1">
          {m.grade && <Badge tone="grade">{m.grade}</Badge>}
          {m.part && <Badge tone="part">{m.part}</Badge>}
          <span className="text-slate-200">{stripAffiliationNoteForDisplay(m.name)}</span>
        </li>
      ))}
    </ul>
  );
}

export function SetlistLines({ setlist }: { setlist: Application["setlist"] }) {
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

// Compact badge for "how many of this band's members are already spread
// across 3+ bands elsewhere" — a lottery/scheduling signal, not shown at
// all when zero (keeps rows without any high-participation member free of
// clutter). Click toggles an inline breakdown ("3枠: 1人, 4枠: 1人"); the
// same text is also on the badge's title so a mouse hover shows it without
// a click, satisfying both interaction styles on desktop and touch.
export function HighParticipationBadge({ info }: { info: HighParticipationInfo }) {
  const [expanded, setExpanded] = useState(false);
  if (info.highCount === 0) return null;

  const breakdownText = info.breakdown.map((b) => `${b.slots}枠: ${b.people}人`).join(" / ");

  return (
    <div className="inline-block">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        title={breakdownText}
        aria-expanded={expanded}
        className="inline-flex min-h-9 items-center whitespace-nowrap rounded-md border border-amber-500 bg-amber-950 px-2 py-1 text-xs font-semibold leading-none text-amber-300 hover:border-amber-400 md:min-h-0"
      >
        ⚠ 3枠以上: {info.highCount}人
      </button>
      {expanded && (
        <p className="mt-1 max-w-[12rem] text-[11px] font-normal leading-snug text-amber-300">
          {breakdownText}
        </p>
      )}
    </div>
  );
}

// Opens the exact same Band-editing modal the Timetable Editor's own
// per-slot "⋮" button opens (PlacedBandDetailModal — see that component's
// own doc for what it edits and how it saves) — not a second, parallel
// edit UI. `slot` is intentionally omitted (see PlacedBandDetailModal's
// now-optional `slot` prop): there's no timetable slot in this screen's
// context, only a Band. Only ever called with a `bandId` the caller has
// already confirmed came from a truthy `linkedBandId` (both call sites
// below gate on that), but still guards against a stale id (a linked
// Band that's since been deleted) the same way LiveCompositionRatingStars
// does, so a stale reference can't crash this screen.
export function EditBandButton({ bandId, className }: { bandId: string; className: string }) {
  const band = useAppStore((s) => s.bands.find((b) => b.id === bandId));
  const [showEdit, setShowEdit] = useState(false);
  if (!band) return null;
  return (
    <>
      <button type="button" onClick={() => setShowEdit(true)} className={className}>
        編集
      </button>
      {showEdit && <PlacedBandDetailModal band={band} onClose={() => setShowEdit(false)} />}
    </>
  );
}

export function ApplicationTable({
  applications,
  frameCounts,
  onApprove,
  onUnapprove,
  onRequestReject,
  filterText,
  onFilterTextChange,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("applicationDateTime");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const highParticipationByAppId = useMemo(() => {
    const map = new Map<string, HighParticipationInfo>();
    for (const app of applications) {
      map.set(app.id, computeHighParticipation(app, frameCounts));
    }
    return map;
  }, [applications, frameCounts]);

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
        case "highParticipationCount":
          cmp =
            (highParticipationByAppId.get(a.id)?.highCount ?? 0) -
            (highParticipationByAppId.get(b.id)?.highCount ?? 0);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir, highParticipationByAppId]);

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
            className="min-h-11 rounded border border-slate-600 px-3 text-[11px] text-slate-300 hover:bg-slate-700 md:min-h-0 md:py-1"
          >
            絞り込みを解除
          </button>
        )}
        <span className="text-xs text-slate-500">{sorted.length}件</span>
        <button
          type="button"
          onClick={() => toggleSort("highParticipationCount")}
          className={`min-h-11 rounded border px-3 text-[11px] font-medium md:min-h-0 md:py-1 ${
            sortKey === "highParticipationCount"
              ? "border-amber-500 bg-amber-950/50 text-amber-300"
              : "border-slate-600 text-slate-300 hover:bg-slate-700"
          }`}
        >
          3枠以上の人数で並び替え{sortIndicator("highParticipationCount")}
        </button>
      </div>

      {sorted.length === 0 && (
        <p className="rounded-lg border border-slate-700 px-3 py-6 text-center text-sm text-slate-500">
          該当する申し込みがありません
        </p>
      )}

      {/* Mobile (<768px): one collapsed-by-default accordion card per
          application instead of a table row — a 9-column table has no room
          to stay legible once each column drops to ~35px on a 320px
          screen, so this is a different layout, not just the same table
          squeezed down. See ApplicationMobileCard for why member/setlist
          details collapse behind local per-card state. */}
      {sorted.length > 0 && (
        <div className="flex flex-col gap-2 overflow-y-auto md:hidden">
          {sorted.map((app) => (
            <ApplicationMobileCard
              key={app.id}
              app={app}
              highParticipationInfo={highParticipationByAppId.get(app.id)!}
              onApprove={onApprove}
              onUnapprove={onUnapprove}
              onRequestReject={onRequestReject}
            />
          ))}
        </div>
      )}

      {/* Desktop/tablet (≥768px): dense sortable table. */}
      {sorted.length > 0 && (
        <div className="hidden min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-lg border border-slate-700 md:block">
          <table className="w-full table-fixed border-collapse text-xs">
            <colgroup>
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              <col className="w-[12%]" />
              <col className="w-[12%]" />
              <col className="w-[5%]" />
              <col className="w-[8%]" />
              <col className="w-[6%]" />
              <col className="w-[7%]" />
              <col className="w-[11%]" />
              <col className="w-[12%]" />
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
                <th
                  className={headerClass}
                  onClick={() => toggleSort("highParticipationCount")}
                  title="このバンドのメンバーのうち、全申し込みを通じて3バンド以上に参加している人数"
                >
                  3枠以上{sortIndicator("highParticipationCount")}
                </th>
                <th className={headerClass} onClick={() => toggleSort("durationMinutes")}>
                  演奏時間{sortIndicator("durationMinutes")}
                </th>
                <th className={headerClass} onClick={() => toggleSort("desiredDateTime")}>
                  出演希望日{sortIndicator("desiredDateTime")}
                </th>
                <th className={plainHeaderClass}>状態</th>
                <th className={plainHeaderClass} title="管理者専用。一般公開データには含まれません">
                  ライブ構成評価
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((app) => (
                <tr
                  key={app.id}
                  className={`border-b border-slate-700 last:border-0 ${
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
                  <td className="break-words px-2 py-1.5">
                    <HighParticipationBadge info={highParticipationByAppId.get(app.id)!} />
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
                            : "rounded border border-slate-600 px-2 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-700"
                        }
                      >
                        {app.approved ? "✓ キャンセル" : "承認"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRequestReject(app)}
                        className="rounded border border-rose-700 px-2 py-1 text-[11px] font-medium text-rose-400 hover:bg-rose-950/40"
                      >
                        却下
                      </button>
                      {app.linkedBandId && (
                        <EditBandButton
                          bandId={app.linkedBandId}
                          className="rounded border border-slate-600 px-2 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-700"
                        />
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    {app.linkedBandId ? (
                      <LiveCompositionRatingStars bandId={app.linkedBandId} />
                    ) : (
                      <span className="text-slate-600">-</span>
                    )}
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
