import { useMemo, useState } from "react";
import { useApplicationStore } from "../../store/useApplicationStore";
import { normalizeMemberName } from "../../utils/normalizeMemberName";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { ModalPortal } from "../ModalPortal";
import type { Application, PendingReasonNote } from "../../types";

// 申請前の理由メモ: reasons for a time restriction sometimes arrive on LINE
// before the Discord application does. They're kept here on their own and move
// onto the application's 理由メモ once it exists — automatically when the note
// names the same band (see addApplications), or by the organizer picking the
// application (suggestions below match the sender against the applicant, the
// members and the band name).

function loose(text: string): string {
  return normalizeMemberName(text).toLowerCase();
}

function suggestionsFor(note: PendingReasonNote, applications: Application[]): Application[] {
  const sender = loose(note.senderName);
  const band = loose(note.bandName);
  if (!sender && !band) return [];
  return applications
    .filter((app) => {
      if (band && (loose(app.bandName).includes(band) || band.includes(loose(app.bandName)))) return true;
      if (!sender) return false;
      return (
        loose(app.applicantName).includes(sender) ||
        sender.includes(loose(app.applicantName)) ||
        app.members.some((m) => {
          const name = loose(m.name);
          return name.length > 0 && (name.includes(sender) || sender.includes(name));
        })
      );
    })
    .slice(0, 4);
}

const fieldClass =
  "min-h-11 w-full rounded border border-slate-600 bg-slate-800 px-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-indigo-500 md:min-h-0 md:py-1.5";

export function PendingReasonNotesModal({ onClose }: { onClose: () => void }) {
  useEscapeKey(onClose);
  const notes = useApplicationStore((s) => s.pendingReasonNotes) ?? [];
  const applications = useApplicationStore((s) => s.applications);
  const add = useApplicationStore((s) => s.addPendingReasonNote);
  const update = useApplicationStore((s) => s.updatePendingReasonNote);
  const remove = useApplicationStore((s) => s.removePendingReasonNote);
  const attach = useApplicationStore((s) => s.attachPendingReasonNote);

  const [senderName, setSenderName] = useState("");
  const [bandName, setBandName] = useState("");
  const [note, setNote] = useState("");

  const sortedApplications = useMemo(
    () => [...applications].sort((a, b) => a.bandName.localeCompare(b.bandName, "ja")),
    [applications],
  );

  function handleAdd() {
    if (!note.trim()) return;
    add({ senderName, bandName, note });
    setSenderName("");
    setBandName("");
    setNote("");
  }

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-label="申請前の理由メモ"
          className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2 border-b border-slate-700 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">📝 申請前の理由メモ</h2>
              <p className="mt-0.5 text-xs text-slate-400">
                申請より先にLINEで届いた時間指定の理由を残しておき、申請が来たら紐づけます。バンド名が申請と同じなら、取り込み時に自動で紐づきます。
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

          <div className="space-y-4 overflow-y-auto px-4 py-3">
            <section className="space-y-2 rounded border border-slate-700 bg-slate-950/40 p-3">
              <h3 className="text-xs font-semibold text-slate-400">メモを追加</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  placeholder="送ってきた人（LINE名・申請者名など）"
                  aria-label="送ってきた人"
                  className={fieldClass}
                />
                <input
                  value={bandName}
                  onChange={(e) => setBandName(e.target.value)}
                  placeholder="バンド名（わかれば。同じ名前の申請に自動で紐づく）"
                  aria-label="バンド名"
                  className={fieldClass}
                />
              </div>
              <textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="理由を手書きで（例：17日は午前中だけバイトがあるため）"
                aria-label="理由メモ"
                className={fieldClass}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={!note.trim()}
                  className="min-h-11 rounded bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 md:min-h-0 md:py-1.5"
                >
                  追加
                </button>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-400">紐づけ待ち（{notes.length}件）</h3>
              {notes.length === 0 && (
                <p className="rounded border border-slate-700 px-3 py-4 text-center text-xs text-slate-500">
                  紐づけ待ちのメモはありません
                </p>
              )}
              {notes.map((n) => {
                const suggestions = suggestionsFor(n, applications);
                return (
                  <article key={n.id} className="space-y-2 rounded border border-slate-700 bg-slate-800/40 p-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input
                        value={n.senderName}
                        onChange={(e) => update(n.id, { senderName: e.target.value })}
                        placeholder="送ってきた人"
                        aria-label="送ってきた人"
                        className={fieldClass}
                      />
                      <input
                        value={n.bandName}
                        onChange={(e) => update(n.id, { bandName: e.target.value })}
                        placeholder="バンド名"
                        aria-label="バンド名"
                        className={fieldClass}
                      />
                    </div>
                    <textarea
                      rows={2}
                      value={n.note}
                      onChange={(e) => update(n.id, { note: e.target.value })}
                      aria-label="理由メモ"
                      className={fieldClass}
                    />
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {suggestions.length > 0 && <span className="text-slate-400">候補：</span>}
                      {suggestions.map((app) => (
                        <button
                          key={app.id}
                          type="button"
                          onClick={() => attach(n.id, app.id)}
                          title={`申請者：${app.applicantName}`}
                          className="min-h-11 rounded border border-emerald-600 bg-emerald-950/40 px-2 text-emerald-200 hover:bg-emerald-900/50 md:min-h-0 md:py-1"
                        >
                          {app.bandName} に紐づける
                        </button>
                      ))}
                      <select
                        value=""
                        onChange={(e) => e.target.value && attach(n.id, e.target.value)}
                        aria-label="申請を選んで紐づける"
                        className="min-h-11 max-w-full rounded border border-slate-600 bg-slate-800 px-2 text-slate-200 md:min-h-0 md:py-1"
                      >
                        <option value="">申請を選んで紐づける…</option>
                        {sortedApplications.map((app) => (
                          <option key={app.id} value={app.id}>
                            {app.bandName}（{app.applicantName}）
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => remove(n.id)}
                        className="ml-auto min-h-11 rounded border border-rose-700 px-2 text-rose-300 hover:bg-rose-950/50 md:min-h-0 md:py-1"
                      >
                        削除
                      </button>
                    </div>
                  </article>
                );
              })}
            </section>
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
