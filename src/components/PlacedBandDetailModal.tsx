import { useApplicationStore } from "../store/useApplicationStore";
import { Badge } from "./applications/Badge";
import type { Band } from "../types";

interface Props {
  band: Band;
  onClose: () => void;
}

// Approved applications carry richer data (per-member part/grade, setlist
// artists, free-text preferred date) than the Band they get converted into
// (see applicationToBand in useApplicationStore.ts, which flattens members
// down to plain name strings) — so this looks up the application that
// produced this band via linkedBandId and prefers its fields, falling back
// to the Band's own flatter fields for a band with no such link (manually
// added, or the link was lost some other way).
export function PlacedBandDetailModal({ band, onClose }: Props) {
  const applications = useApplicationStore((s) => s.applications);
  const linkedApp = applications.find((a) => a.linkedBandId === band.id);

  const desiredDateTime = linkedApp?.desiredDateTime || band.desiredTime || "未設定";
  const setlist = linkedApp
    ? linkedApp.setlist.map((s) => (s.artist ? `${s.title} / ${s.artist}` : s.title))
    : band.setlist;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-100">{band.name}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg leading-none text-slate-500 hover:bg-slate-800 hover:text-slate-300"
            title="閉じる"
          >
            ×
          </button>
        </div>

        <dl className="mt-3 space-y-3 text-xs">
          <div>
            <dt className="font-semibold text-slate-500">出演希望日</dt>
            <dd className="mt-0.5 text-slate-200">{desiredDateTime}</dd>
          </div>

          <div>
            <dt className="font-semibold text-slate-500">同期・機材</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              <Badge tone={band.hasSync ? "sync-on" : "sync-off"}>
                同期演奏{band.hasSync ? "あり" : "なし"}
              </Badge>
              {band.hasKeyboard && <Badge tone="part">🎹 キーボードあり</Badge>}
              {band.durationMinutes != null && (
                <span className="inline-flex items-center text-slate-300">
                  演奏時間 {band.durationMinutes}分
                </span>
              )}
            </dd>
          </div>

          <div>
            <dt className="font-semibold text-slate-500">メンバー</dt>
            <dd className="mt-1">
              {linkedApp ? (
                <ul className="space-y-1">
                  {linkedApp.members.map((m, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-1">
                      {m.grade && <Badge tone="grade">{m.grade}</Badge>}
                      {m.part && <Badge tone="part">{m.part}</Badge>}
                      <span className="text-slate-200">{m.name}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-slate-200">{band.members.join(", ") || "未設定"}</p>
              )}
            </dd>
          </div>

          <div>
            <dt className="font-semibold text-slate-500">セットリスト</dt>
            <dd className="mt-1">
              {setlist.length > 0 ? (
                <ul className="space-y-0.5 text-slate-200">
                  {setlist.map((song, i) => (
                    <li key={i}>{song}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-slate-500">未設定</p>
              )}
            </dd>
          </div>
        </dl>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded border border-slate-600 px-4 text-sm font-medium text-slate-300 hover:bg-slate-800 sm:min-h-0 sm:py-1.5 sm:text-xs"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
