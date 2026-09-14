import { useMemo } from "react";
import type { Application } from "../../types";
import { listMemberFrameDetails, HIGH_PARTICIPATION_THRESHOLD } from "../../store/useApplicationStore";
import { stripAffiliationNoteForDisplay } from "../../utils/parseBands";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { Badge } from "./Badge";

interface Props {
  app: Application;
  applications: Application[];
  onClose: () => void;
}

// Per-band popup for the Application Manager: for this band's own member
// list, exactly which other bands (not just how many) each person is also
// on — the concrete detail behind both the "現在N枠" grade badges in
// MemberFrameCounts and the "⚠ 3枠以上" HighParticipationBadge on this same
// row, which only ever surface a bare count.
export function MemberFrameDetailModal({ app, applications, onClose }: Props) {
  useEscapeKey(onClose);
  const details = useMemo(() => listMemberFrameDetails(applications, app), [applications, app]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">👥 {app.bandName} のメンバー枠数</h2>
            <p className="mt-1 text-xs text-slate-400">
              このバンドのメンバーが、他にどのバンドを組んでいるかの一覧です。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg leading-none text-slate-500 hover:bg-slate-700 hover:text-slate-300"
            title="閉じる"
          >
            ×
          </button>
        </div>

        <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
          {details.length === 0 && (
            <p className="rounded-md border border-slate-700 px-3 py-6 text-center text-xs text-slate-500">
              メンバーが登録されていません
            </p>
          )}
          {details.map((d, i) => {
            const isHigh = d.bandNames.length >= HIGH_PARTICIPATION_THRESHOLD;
            return (
              <div
                key={i}
                className={`rounded-md border p-3 ${
                  isHigh ? "border-amber-700 bg-amber-950/20" : "border-slate-700 bg-slate-800/40"
                }`}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  {d.grade && <Badge tone="grade">{d.grade}</Badge>}
                  {d.part && <Badge tone="part">{d.part}</Badge>}
                  <span className="text-sm font-medium text-slate-100">
                    {stripAffiliationNoteForDisplay(d.name)}
                  </span>
                  {d.frameOrdinal !== null && (
                    <span
                      className="text-xs text-slate-400"
                      title="申請データに記載されていた、このメンバー自身の枠番号"
                    >
                      （{d.frameOrdinal}枠目）
                    </span>
                  )}
                  <Badge tone={isHigh ? "warning" : "grade"} className="ml-auto">
                    {d.bandNames.length}枠
                  </Badge>
                </div>
                <p className={`mt-1.5 text-xs ${isHigh ? "text-amber-300" : "text-slate-400"}`}>
                  {d.bandNames.join("、")}
                </p>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex shrink-0 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded border border-slate-600 px-4 text-sm font-medium text-slate-300 hover:bg-slate-700 sm:min-h-0 sm:py-1.5 sm:text-xs"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
