import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useApplicationStore } from "../store/useApplicationStore";
import { Badge } from "./applications/Badge";
import type { Band, TimetableSlot } from "../types";

interface Props {
  band: Band;
  slot: TimetableSlot;
  onClose: () => void;
}

// Approved applications carry richer data (per-member part/grade, setlist
// artists, free-text preferred date) than the Band they get converted into
// (see applicationToBand in useApplicationStore.ts, which flattens members
// down to plain name strings) — so this looks up the application that
// produced this band via linkedBandId and prefers its fields, falling back
// to the Band's own flatter fields for a band with no such link (manually
// added, or the link was lost some other way). Editing here only ever
// touches the Band (via updateBand) — the linked Application stays exactly
// as submitted, since it's the historical record of what was applied for,
// not the timetable's own display copy.
export function PlacedBandDetailModal({ band, slot, onClose }: Props) {
  const applications = useApplicationStore((s) => s.applications);
  const updateBand = useAppStore((s) => s.updateBand);
  const linkedApp = applications.find((a) => a.linkedBandId === band.id);

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(band.name);
  const [editDuration, setEditDuration] = useState(
    band.durationMinutes != null ? String(band.durationMinutes) : "",
  );

  const desiredDateTime = linkedApp?.desiredDateTime || band.desiredTime || "未設定";
  const setlist = linkedApp
    ? linkedApp.setlist.map((s) => (s.artist ? `${s.title} / ${s.artist}` : s.title))
    : band.setlist;

  function startEditing() {
    setEditName(band.name);
    setEditDuration(band.durationMinutes != null ? String(band.durationMinutes) : "");
    setIsEditing(true);
  }

  function handleSave() {
    const trimmedName = editName.trim();
    if (!trimmedName) return;
    const parsedDuration = editDuration.trim() ? Number(editDuration) : null;
    if (parsedDuration != null && (!Number.isFinite(parsedDuration) || parsedDuration <= 0)) {
      return;
    }
    // Slot start/end times aren't stored on the Band itself — they're
    // recomputed from cumulative durations down the day whenever any band's
    // durationMinutes changes (see recomputeTimes in useAppStore), so
    // changing the number here is what "moves" this band's time on the
    // grid, including every band after it that day.
    updateBand(band.id, {
      name: trimmedName,
      durationMinutes: parsedDuration ?? undefined,
    });
    setIsEditing(false);
  }

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
          {isEditing ? (
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="min-h-11 flex-1 rounded border border-indigo-500 bg-slate-800 px-2 py-1 text-sm font-semibold text-slate-100 outline-none md:min-h-0"
              placeholder="バンド名"
              autoFocus
            />
          ) : (
            <h2 className="text-sm font-semibold text-slate-100">{band.name}</h2>
          )}
          {!isEditing && (
            <button
              type="button"
              onClick={startEditing}
              className="flex h-9 shrink-0 items-center gap-1 rounded border border-slate-600 px-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
              title="バンド名・演奏時間を編集"
            >
              ✎ 編集
            </button>
          )}
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
            <dt className="font-semibold text-slate-500">演奏時間</dt>
            <dd className="mt-0.5 text-slate-200">
              {isEditing ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    value={editDuration}
                    onChange={(e) => setEditDuration(e.target.value)}
                    className="min-h-11 w-20 rounded border border-indigo-500 bg-slate-800 px-2 py-1 text-sm text-slate-100 outline-none [appearance:textfield] md:min-h-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <span>分</span>
                </div>
              ) : (
                <>
                  {slot.startTime && slot.endTime
                    ? `${slot.startTime} - ${slot.endTime}`
                    : "未配置"}
                  {band.durationMinutes != null && (
                    <span className="ml-1.5 text-slate-400">
                      （{band.durationMinutes}分）
                    </span>
                  )}
                </>
              )}
            </dd>
            {isEditing && (
              <p className="mt-1 text-[11px] text-slate-500">
                演奏時間を変更すると、この枠以降の開始・終了時刻が自動的に再計算されます
              </p>
            )}
          </div>

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

        <div className="mt-5 flex justify-end gap-2">
          {isEditing ? (
            <>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="min-h-11 rounded border border-slate-600 px-4 text-sm font-medium text-slate-300 hover:bg-slate-800 sm:min-h-0 sm:py-1.5 sm:text-xs"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!editName.trim()}
                className="min-h-11 rounded bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 sm:py-1.5 sm:text-xs"
              >
                保存
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded border border-slate-600 px-4 text-sm font-medium text-slate-300 hover:bg-slate-800 sm:min-h-0 sm:py-1.5 sm:text-xs"
            >
              閉じる
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
