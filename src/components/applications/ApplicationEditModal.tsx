import { useState } from "react";
import type { Application, ApplicationMember } from "../../types";
import { useApplicationStore } from "../../store/useApplicationStore";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { hasUnparsedDayHint, hasUnparsedTimeExpression } from "../../utils/parseBands";
import { splitSetlistEntry } from "../../utils/parseApplications";
import { ModalPortal } from "../ModalPortal";

// 申請を編集: fix what the parser got wrong in an application (or add what was
// missing) without re-importing it. Works for approved applications too — the
// store pushes the same values into the linked Band.

type MemberDraft = { name: string; part: string; grade: string; frameOrdinal: string };

const fieldClass =
  "min-h-11 w-full rounded border border-slate-600 bg-slate-800 px-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-indigo-500 md:min-h-0 md:py-1.5";

function toDraft(m: ApplicationMember): MemberDraft {
  return {
    name: m.name,
    part: m.part,
    grade: m.grade,
    frameOrdinal: m.frameOrdinal != null ? String(m.frameOrdinal) : "",
  };
}

export function ApplicationEditModal({ app, onClose }: { app: Application; onClose: () => void }) {
  useEscapeKey(onClose);
  const update = useApplicationStore((s) => s.updateApplication);

  const [bandName, setBandName] = useState(app.bandName);
  const [applicantName, setApplicantName] = useState(app.applicantName);
  const [duration, setDuration] = useState(app.durationMinutes != null ? String(app.durationMinutes) : "");
  const [hasSync, setHasSync] = useState(app.hasSync);
  const [members, setMembers] = useState<MemberDraft[]>(app.members.map(toDraft));
  const [setlist, setSetlist] = useState(
    app.setlist.map((s) => (s.artist ? `${s.title} / ${s.artist}` : s.title)).join("\n"),
  );
  const [desired, setDesired] = useState(app.desiredDateTime);
  const [reasonNote, setReasonNote] = useState(app.timeReasonNote ?? "");
  const [error, setError] = useState("");

  const desiredUnparsed = hasUnparsedTimeExpression(desired) || hasUnparsedDayHint(desired);

  function patchMember(index: number, patch: Partial<MemberDraft>) {
    setMembers((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }

  function handleSave() {
    if (!bandName.trim()) {
      setError("バンド名を入力してください");
      return;
    }
    const minutes = duration.trim() ? Number(duration) : null;
    if (minutes !== null && (!Number.isFinite(minutes) || minutes <= 0)) {
      setError("演奏時間は1以上の数字で入力してください");
      return;
    }
    const cleanedMembers: ApplicationMember[] = members
      .map((m) => ({
        name: m.name.trim(),
        part: m.part.trim(),
        grade: m.grade.trim(),
        frameOrdinal: m.frameOrdinal.trim() ? Number(m.frameOrdinal) : null,
      }))
      .filter((m) => m.name.length > 0)
      .map((m) => ({
        ...m,
        frameOrdinal: m.frameOrdinal !== null && Number.isFinite(m.frameOrdinal) ? m.frameOrdinal : null,
      }));
    update(app.id, {
      applicantName,
      bandName,
      durationMinutes: minutes,
      hasSync,
      members: cleanedMembers,
      setlist: setlist
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map(splitSetlistEntry),
      desiredDateTime: desired,
      timeReasonNote: reasonNote,
    });
    onClose();
  }

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-label="申請を編集"
          className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2 border-b border-slate-700 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">✎ 申請を編集</h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {app.approved
                  ? "承認済みです。保存すると、タイムテーブル上のバンドにも同じ内容が反映されます。"
                  : "取り込んだ内容の誤りを直せます。"}
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

          <div className="space-y-4 overflow-y-auto px-4 py-3 text-xs text-slate-300">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="font-semibold text-slate-400">バンド名</span>
                <input value={bandName} onChange={(e) => setBandName(e.target.value)} className={fieldClass} />
              </label>
              <label className="space-y-1">
                <span className="font-semibold text-slate-400">申請者氏名</span>
                <input
                  value={applicantName}
                  onChange={(e) => setApplicantName(e.target.value)}
                  className={fieldClass}
                />
              </label>
              <label className="space-y-1">
                <span className="font-semibold text-slate-400">演奏時間（分）</span>
                <input
                  type="number"
                  min={1}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  placeholder="未記入"
                  className={fieldClass}
                />
              </label>
              <label className="flex min-h-11 items-center gap-2 self-end md:min-h-0">
                <input type="checkbox" checked={hasSync} onChange={(e) => setHasSync(e.target.checked)} />
                同期演奏あり
              </label>
            </div>

            <section className="space-y-2">
              <h3 className="font-semibold text-slate-400">メンバー</h3>
              {members.map((m, i) => (
                <div key={i} className="grid grid-cols-[4rem_5rem_1fr_4.5rem_2.5rem] items-center gap-1.5">
                  <input
                    value={m.grade}
                    onChange={(e) => patchMember(i, { grade: e.target.value })}
                    placeholder="学年"
                    aria-label="学年"
                    className={fieldClass}
                  />
                  <input
                    value={m.part}
                    onChange={(e) => patchMember(i, { part: e.target.value })}
                    placeholder="パート"
                    aria-label="パート"
                    className={fieldClass}
                  />
                  <input
                    value={m.name}
                    onChange={(e) => patchMember(i, { name: e.target.value })}
                    placeholder="名前"
                    aria-label="名前"
                    className={fieldClass}
                  />
                  <input
                    value={m.frameOrdinal}
                    onChange={(e) => patchMember(i, { frameOrdinal: e.target.value })}
                    placeholder="N枠目"
                    aria-label="N枠目（2.5などの小数も可）"
                    inputMode="decimal"
                    className={fieldClass}
                  />
                  <button
                    type="button"
                    onClick={() => setMembers((prev) => prev.filter((_, j) => j !== i))}
                    aria-label="このメンバーを削除"
                    className="flex h-11 w-full items-center justify-center rounded text-slate-500 hover:text-rose-400 md:h-8"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setMembers((prev) => [...prev, { name: "", part: "", grade: "", frameOrdinal: "" }])}
                className="min-h-11 rounded border border-slate-600 px-3 text-slate-200 hover:bg-slate-800 md:min-h-0 md:py-1"
              >
                + メンバーを追加
              </button>
            </section>

            <label className="block space-y-1">
              <span className="font-semibold text-slate-400">セットリスト（1行に1曲。「曲名 / アーティスト」）</span>
              <textarea rows={4} value={setlist} onChange={(e) => setSetlist(e.target.value)} className={fieldClass} />
            </label>

            <label className="block space-y-1">
              <span className="font-semibold text-slate-400">出演希望日</span>
              <input
                value={desired}
                onChange={(e) => setDesired(e.target.value)}
                placeholder="例：17日 16:00以降 / 両日可能"
                className={`${fieldClass} ${desiredUnparsed ? "!border-amber-500" : ""}`}
              />
              {desiredUnparsed && (
                <span className="block text-[11px] text-amber-400">
                  ⚠ 認識されない書き方です（「17日」「16:00以降」など）
                </span>
              )}
            </label>

            <label className="block space-y-1">
              <span className="font-semibold text-slate-400">時間指定の理由メモ</span>
              <textarea
                rows={2}
                value={reasonNote}
                onChange={(e) => setReasonNote(e.target.value)}
                placeholder="LINEで届いた理由を手書きで"
                className={fieldClass}
              />
            </label>

            {error && <p className="text-rose-400">{error}</p>}
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-700 px-4 py-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded border border-slate-600 px-4 text-xs text-slate-200 hover:bg-slate-800 md:min-h-0 md:py-1.5"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="min-h-11 rounded bg-indigo-600 px-4 text-xs font-semibold text-white hover:bg-indigo-500 md:min-h-0 md:py-1.5"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
