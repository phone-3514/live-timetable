import { useMemo, useState } from "react";
import { useApplicationStore } from "../../store/useApplicationStore";
import { useAppStore } from "../../store/useAppStore";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { groupBandsByArtist } from "../../utils/artistGroups";
import { ModalPortal } from "../ModalPortal";

// 同じアーティストのカバー: the bands whose setlists name the same artist,
// grouped, with each band's songs by that artist — and, once a band is on the
// timetable, where it is, so a group can be spread out rather than bunched up.
export function SameArtistGroupsModal({ onClose }: { onClose: () => void }) {
  useEscapeKey(onClose);
  const applications = useApplicationStore((s) => s.applications);
  const days = useAppStore((s) => s.days);
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [showSingles, setShowSingles] = useState(false);

  const placement = useMemo(() => {
    const map = new Map<string, string>();
    for (const day of days) {
      for (const slot of day.slots) {
        if (slot.bandId) map.set(slot.bandId, `${day.label} ${slot.startTime || "時刻未定"}`);
      }
    }
    return map;
  }, [days]);

  const groups = useMemo(
    () => groupBandsByArtist(applications.filter((a) => !approvedOnly || a.approved), showSingles ? 1 : 2),
    [applications, approvedOnly, showSingles],
  );

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-label="同じアーティストのカバー"
          className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2 border-b border-slate-700 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">🎤 同じアーティストのカバー</h2>
              <p className="mt-0.5 text-xs text-slate-400">
                セットリストに同じアーティストが書かれているバンドをまとめます（表記が違う名前は別のアーティスト扱いです）。
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="閉じる"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-slate-100 md:h-8 md:w-8"
            >
              ✕
            </button>
          </div>

          <div className="space-y-3 overflow-y-auto px-4 py-3 text-xs text-slate-300">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <label className="flex min-h-11 items-center gap-1.5 md:min-h-0">
                <input type="checkbox" checked={approvedOnly} onChange={(e) => setApprovedOnly(e.target.checked)} />
                承認済みのバンドだけ
              </label>
              <label className="flex min-h-11 items-center gap-1.5 md:min-h-0">
                <input type="checkbox" checked={showSingles} onChange={(e) => setShowSingles(e.target.checked)} />
                1バンドだけのアーティストも表示
              </label>
            </div>

            {groups.length === 0 ? (
              <p className="rounded border border-slate-700 px-3 py-6 text-center text-slate-500">
                同じアーティストをカバーしているバンドはありません
              </p>
            ) : (
              <>
                <p className="text-slate-400">{groups.length}アーティスト</p>
                <ul className="space-y-2">
                  {groups.map((group) => (
                    <li key={group.key} className="space-y-1.5 rounded border border-slate-700 bg-slate-800/40 p-3">
                      <p className="text-sm font-semibold text-slate-100">
                        🎤 {group.name}
                        <span className="ml-2 text-xs font-normal text-amber-300">{group.entries.length}バンド</span>
                      </p>
                      <ul className="space-y-1">
                        {group.entries.map(({ app, titles }) => {
                          const where = app.linkedBandId ? placement.get(app.linkedBandId) : undefined;
                          return (
                            <li key={app.id} className="rounded border border-slate-700 bg-slate-950/40 p-1.5">
                              <p className="break-words text-slate-100">
                                {app.bandName}
                                <span className="ml-1.5 text-[10px] text-slate-500">
                                  {app.approved ? "承認済み" : "未承認"}
                                  {where ? ` ／ ${where}` : ""}
                                </span>
                              </p>
                              <p className="break-words text-slate-400">{titles.join("、")}</p>
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="border-t border-slate-700 px-4 py-2 text-right">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded border border-slate-600 px-4 text-xs text-slate-200 hover:bg-slate-800 md:min-h-0 md:py-1.5"
            >
              閉じる
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
