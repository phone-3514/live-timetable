import { useState } from "react";
import type { Application } from "../../types";
import type { HighParticipationInfo } from "../../store/useApplicationStore";
import { Badge } from "./Badge";
import { HighParticipationBadge, MemberBadgeList, SetlistLines } from "./ApplicationTable";

type Props = {
  app: Application;
  highParticipationInfo: HighParticipationInfo;
  onApprove: (id: string) => void;
  onUnapprove: (id: string) => void;
  onRequestReject: (app: Application) => void;
};

// One applicant/band as a collapsed-by-default accordion card — below
// md:768px (see ApplicationTable, which renders this only in its
// `md:hidden` branch) a 9-column table has no room to stay legible, and
// even the previous flat mobile card (member badges + full setlist always
// expanded) pushed the approve/reject buttons for a many-member band well
// off the first screen. `expanded` is plain local useState: it only ever
// toggles what THIS card shows, never touches useApplicationStore, so it
// can't race with or get overwritten by an incoming Firestore snapshot
// (see useCollabRoom.ts) the way anything stored in that global store
// would risk.
export function ApplicationMobileCard({
  app,
  highParticipationInfo,
  onApprove,
  onUnapprove,
  onRequestReject,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = app.members.length > 0 || app.setlist.length > 0;

  return (
    <div
      className={`rounded-lg border p-3 ${
        app.approved ? "border-emerald-700 bg-emerald-950/20" : "border-slate-700 bg-slate-800"
      }`}
    >
      <button
        type="button"
        onClick={() => hasDetails && setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full min-h-11 items-start justify-between gap-2 text-left"
      >
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-slate-100">{app.bandName}</p>
          <p className="mt-0.5 truncate text-xs text-slate-400">
            {app.applicantName || "-"} ・ {app.applicationDateTime || "-"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge tone={app.approved ? "status-approved" : "status-pending"}>
            {app.approved ? "承認済み" : "未承認"}
          </Badge>
          {hasDetails && (
            <span className="flex h-6 w-6 items-center justify-center text-slate-500" aria-hidden="true">
              {expanded ? "▲" : "▼"}
            </span>
          )}
        </div>
      </button>

      {app.parseWarning && <p className="mt-1.5 text-xs text-amber-400">⚠ {app.parseWarning}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge tone={app.hasSync ? "sync-on" : "sync-off"}>同期{app.hasSync ? "あり" : "なし"}</Badge>
        {app.durationMinutes != null && (
          <span className="text-xs text-slate-300">{app.durationMinutes}分</span>
        )}
        {app.desiredDateTime && <span className="text-xs text-slate-300">・{app.desiredDateTime}</span>}
      </div>

      {highParticipationInfo.highCount > 0 && (
        <div className="mt-2">
          <HighParticipationBadge info={highParticipationInfo} />
        </div>
      )}

      {expanded && (
        <div className="mt-2 border-t border-slate-700 pt-2">
          {app.setlist.length > 0 && (
            <div className="text-xs text-slate-300">
              <p className="mb-0.5 font-semibold text-slate-500">セットリスト</p>
              <SetlistLines setlist={app.setlist} />
            </div>
          )}
          {app.members.length > 0 && (
            <div className={`text-xs ${app.setlist.length > 0 ? "mt-2" : ""}`}>
              <p className="mb-1 font-semibold text-slate-500">メンバー</p>
              <MemberBadgeList members={app.members} />
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => (app.approved ? onUnapprove(app.id) : onApprove(app.id))}
          className={`min-h-11 flex-1 rounded-md text-sm font-semibold ${
            app.approved
              ? "border border-emerald-600 bg-emerald-900/40 text-emerald-300"
              : "bg-emerald-600 text-white hover:bg-emerald-500"
          }`}
        >
          {app.approved ? "✓ キャンセル" : "承認"}
        </button>
        <button
          type="button"
          onClick={() => onRequestReject(app)}
          className="min-h-11 flex-1 rounded-md border-2 border-rose-600 text-sm font-semibold text-rose-400 hover:bg-rose-950/50"
        >
          却下
        </button>
      </div>
    </div>
  );
}
