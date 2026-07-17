import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useApplicationStore } from "../store/useApplicationStore";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { Badge } from "./applications/Badge";
import type { Band, BandMemberDetail, TimetableSlot } from "../types";

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

  // Priority for what's actually shown/edited: the band's own
  // memberDetails once anyone has edited it (see handleSave), then a
  // linked Application's members (pre-editing behavior), then plain names
  // with blank grade/part for a band with neither. Same order
  // computeSetlistEntries uses, so this modal and the Setlist export never
  // disagree about which member data is current.
  const displayMembers: BandMemberDetail[] =
    band.memberDetails && band.memberDetails.length > 0
      ? band.memberDetails
      : linkedApp
        ? linkedApp.members.map((m) => ({ name: m.name, grade: m.grade, part: m.part }))
        : band.members.map((name) => ({ name, grade: "", part: "" }));

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(band.name);
  const [editDuration, setEditDuration] = useState(
    band.durationMinutes != null ? String(band.durationMinutes) : "",
  );
  const [editGearTags, setEditGearTags] = useState(band.gearTags.join(", "));
  const [editMembers, setEditMembers] = useState<BandMemberDetail[]>([]);

  // Escape cancels an in-progress edit first (same as clicking
  // "キャンセル"), rather than immediately closing the whole modal out from
  // under unsaved changes — only closes the modal outright once there's no
  // edit in progress to lose.
  useEscapeKey(() => {
    if (isEditing) {
      setIsEditing(false);
    } else {
      onClose();
    }
  });

  const desiredDateTime = linkedApp?.desiredDateTime || band.desiredTime || "未設定";
  const setlist = linkedApp
    ? linkedApp.setlist.map((s) => (s.artist ? `${s.title} / ${s.artist}` : s.title))
    : band.setlist;

  function startEditing() {
    setEditName(band.name);
    setEditDuration(band.durationMinutes != null ? String(band.durationMinutes) : "");
    setEditGearTags(band.gearTags.join(", "));
    setEditMembers(displayMembers.map((m) => ({ ...m })));
    setIsEditing(true);
  }

  function updateEditMember(index: number, patch: Partial<BandMemberDetail>) {
    setEditMembers((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }

  function removeEditMember(index: number) {
    setEditMembers((prev) => prev.filter((_, i) => i !== index));
  }

  function addEditMember() {
    setEditMembers((prev) => [...prev, { name: "", grade: "", part: "" }]);
  }

  function handleSave() {
    const trimmedName = editName.trim();
    if (!trimmedName) return;
    const parsedDuration = editDuration.trim() ? Number(editDuration) : null;
    if (parsedDuration != null && (!Number.isFinite(parsedDuration) || parsedDuration <= 0)) {
      return;
    }
    // Blank-name rows (an added-then-abandoned row, or a name someone
    // cleared) are dropped rather than saved as an empty member — same
    // "don't persist obviously-incomplete input" rule the gear-tag field
    // below already follows (empty tags filtered out after the comma
    // split).
    const cleanedMembers = editMembers
      .map((m) => ({ name: m.name.trim(), grade: m.grade.trim(), part: m.part.trim() }))
      .filter((m) => m.name.length > 0);
    // Slot start/end times aren't stored on the Band itself — they're
    // recomputed from cumulative durations down the day whenever any band's
    // durationMinutes changes (see recomputeTimes in useAppStore), so
    // changing the number here is what "moves" this band's time on the
    // grid, including every band after it that day.
    updateBand(band.id, {
      name: trimmedName,
      durationMinutes: parsedDuration ?? undefined,
      gearTags: editGearTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      memberDetails: cleanedMembers,
      // members stays a plain name list in sync with memberDetails — it's
      // what the Timetable display and conflict detection
      // (getMemberConflictDetails) actually read, so a rename here needs
      // to show up there too, not just in the Setlist export.
      members: cleanedMembers.map((m) => m.name),
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
              title="バンド名・演奏時間・メンバーを編集"
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
            <dt className="font-semibold text-slate-500">共有機材タグ</dt>
            <dd className="mt-1">
              {isEditing ? (
                <input
                  value={editGearTags}
                  onChange={(e) => setEditGearTags(e.target.value)}
                  placeholder="カンマ区切り（例：共有キーボード）"
                  className="min-h-11 w-full rounded border border-indigo-500 bg-slate-800 px-2 py-1 text-sm text-slate-100 outline-none placeholder:text-slate-500 md:min-h-0"
                />
              ) : band.gearTags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {band.gearTags.map((tag) => (
                    <Badge key={tag} tone="warning">
                      ⚙ {tag}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-slate-500">未設定</p>
              )}
            </dd>
          </div>

          <div>
            <dt className="font-semibold text-slate-500">メンバー</dt>
            <dd className="mt-1">
              {isEditing ? (
                <div className="space-y-1.5">
                  {editMembers.map((m, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-1.5">
                      <input
                        value={m.grade}
                        onChange={(e) => updateEditMember(i, { grade: e.target.value })}
                        placeholder="学年"
                        aria-label={`メンバー${i + 1}の学年`}
                        className="min-h-11 w-14 rounded border border-indigo-500 bg-slate-800 px-1.5 py-1 text-xs text-slate-100 outline-none placeholder:text-slate-500 md:min-h-0"
                      />
                      <input
                        value={m.part}
                        onChange={(e) => updateEditMember(i, { part: e.target.value })}
                        placeholder="パート"
                        aria-label={`メンバー${i + 1}のパート`}
                        className="min-h-11 w-16 rounded border border-indigo-500 bg-slate-800 px-1.5 py-1 text-xs text-slate-100 outline-none placeholder:text-slate-500 md:min-h-0"
                      />
                      <input
                        value={m.name}
                        onChange={(e) => updateEditMember(i, { name: e.target.value })}
                        placeholder="氏名"
                        aria-label={`メンバー${i + 1}の氏名`}
                        className="min-h-11 min-w-24 flex-1 rounded border border-indigo-500 bg-slate-800 px-1.5 py-1 text-xs text-slate-100 outline-none placeholder:text-slate-500 md:min-h-0"
                      />
                      <button
                        type="button"
                        onClick={() => removeEditMember(i)}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-rose-950/60 hover:text-rose-400 md:h-6 md:w-6"
                        title="このメンバーを削除"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addEditMember}
                    className="min-h-9 rounded border border-slate-600 px-2 text-xs text-slate-300 hover:bg-slate-800 md:min-h-0 md:py-1"
                  >
                    + メンバーを追加
                  </button>
                </div>
              ) : displayMembers.length > 0 ? (
                <ul className="space-y-1">
                  {displayMembers.map((m, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-1">
                      {m.grade && <Badge tone="grade">{m.grade}</Badge>}
                      {m.part && <Badge tone="part">{m.part}</Badge>}
                      <span className="text-slate-200">{m.name}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-slate-500">未設定</p>
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
