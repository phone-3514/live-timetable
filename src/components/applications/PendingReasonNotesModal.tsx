import { useMemo, useState } from "react";
import { useApplicationStore } from "../../store/useApplicationStore";
import { normalizeMemberName } from "../../utils/normalizeMemberName";
import { stripAffiliationNoteForDisplay } from "../../utils/parseBands";
import { describeMemberWindow, parseMemberConstraintText } from "../../utils/memberConstraints";
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

type PersonOption = { key: string; name: string };

// Every distinct member across the applications (by normalized name) — what a
// note about a person, rather than a band, can be attached to.
function listPeople(applications: Application[]): PersonOption[] {
  const byKey = new Map<string, PersonOption>();
  for (const app of applications) {
    for (const m of app.members) {
      const key = normalizeMemberName(m.name);
      if (key && !byKey.has(key)) byKey.set(key, { key, name: stripAffiliationNoteForDisplay(m.name) });
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

function personSuggestionsFor(note: PendingReasonNote, people: PersonOption[]): PersonOption[] {
  const sender = loose(note.senderName);
  if (!sender) return [];
  return people
    .filter((p) => {
      const name = loose(p.name);
      return name.length > 0 && (name.includes(sender) || sender.includes(name));
    })
    .slice(0, 4);
}

const fieldClass =
  "min-h-11 w-full rounded border border-slate-600 bg-slate-800 px-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-indigo-500 md:min-h-0 md:py-1.5";

export function PendingReasonNotesModal({ onClose }: { onClose: () => void }) {
  useEscapeKey(onClose);
  const allNotes = useApplicationStore((s) => s.pendingReasonNotes) ?? [];
  const notes = useMemo(() => allNotes.filter((n) => !n.attachedTo), [allNotes]);
  const attachedNotes = useMemo(
    () => allNotes.filter((n) => n.attachedTo).sort((a, b) => (b.attachedAt ?? 0) - (a.attachedAt ?? 0)),
    [allNotes],
  );
  const unattach = useApplicationStore((s) => s.unattachPendingReasonNote);
  const applications = useApplicationStore((s) => s.applications);
  const add = useApplicationStore((s) => s.addPendingReasonNote);
  const update = useApplicationStore((s) => s.updatePendingReasonNote);
  const remove = useApplicationStore((s) => s.removePendingReasonNote);
  const attach = useApplicationStore((s) => s.attachPendingReasonNote);
  const attachToMember = useApplicationStore((s) => s.attachPendingReasonNoteToMember);
  const memberNotes = useApplicationStore((s) => s.memberReasonNotes) ?? [];
  const setMemberNote = useApplicationStore((s) => s.setMemberReasonNote);
  const editMemberNote = useApplicationStore((s) => s.editMemberReasonNote);
  const people = useMemo(() => listPeople(applications), [applications]);

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
                const personSuggestions = personSuggestionsFor(n, people);
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
                      {personSuggestions.map((p) => (
                        <button
                          key={p.key}
                          type="button"
                          onClick={() => attachToMember(n.id, p.name)}
                          title="この人が出るすべてのバンドに表示されます"
                          className="min-h-11 rounded border border-sky-600 bg-sky-950/40 px-2 text-sky-200 hover:bg-sky-900/50 md:min-h-0 md:py-1"
                        >
                          👤 {p.name} 個人に紐づける
                        </button>
                      ))}
                      <select
                        value=""
                        onChange={(e) => e.target.value && attachToMember(n.id, e.target.value)}
                        aria-label="人を選んで個人に紐づける"
                        className="min-h-11 max-w-full rounded border border-slate-600 bg-slate-800 px-2 text-slate-200 md:min-h-0 md:py-1"
                      >
                        <option value="">👤 人を選んで個人に紐づける…</option>
                        {people.map((p) => (
                          <option key={p.key} value={p.name}>
                            {p.name}
                          </option>
                        ))}
                      </select>
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

          {attachedNotes.length > 0 && (
            <details className="border-t border-slate-700 px-4 py-3">
              <summary className="cursor-pointer select-none text-xs font-semibold text-slate-400 hover:text-slate-200">
                紐づけ済みの履歴（{attachedNotes.length}件）— 申請を初期化してもここに残ります
              </summary>
              <ul className="mt-2 space-y-2">
                {attachedNotes.map((n) => (
                  <li key={n.id} className="space-y-1 rounded border border-slate-700 bg-slate-800/30 p-2 text-xs">
                    <p className="text-slate-400">
                      {n.senderName && `${n.senderName} ／ `}
                      {n.attachedTo?.kind === "member" ? `👤 ${n.attachedTo.name} に紐づけ済み` : `${n.attachedTo?.label ?? ""} に紐づけ済み`}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-slate-200">{n.note}</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => unattach(n.id)}
                        className="min-h-11 rounded border border-slate-600 px-2 text-slate-300 hover:bg-slate-700 md:min-h-0 md:py-0.5"
                      >
                        紐づけ待ちに戻す
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(n.id)}
                        className="min-h-11 rounded border border-rose-700 px-2 text-rose-300 hover:bg-rose-950/50 md:min-h-0 md:py-0.5"
                      >
                        削除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {memberNotes.length > 0 && (
            <section className="space-y-2 border-t border-slate-700 px-4 py-3">
              <h3 className="text-xs font-semibold text-slate-400">
                個人に紐づけたメモ（{memberNotes.length}人）— その人が出るすべてのバンドに表示されます
              </h3>
              {memberNotes
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name, "ja"))
                .map((m) => (
                  <div key={m.key} className="flex items-start gap-2">
                    <span className="w-28 shrink-0 break-words pt-2 text-xs font-medium text-sky-200 md:pt-1.5">
                      👤 {m.name}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <textarea
                        rows={2}
                        value={m.note}
                        onChange={(e) => editMemberNote(m.key, e.target.value)}
                        aria-label={`${m.name}の理由メモ`}
                        className={fieldClass}
                      />
                      {(() => {
                        const parsed = parseMemberConstraintText(m.note);
                        return (
                          <div className="space-y-0.5 text-[11px]">
                            {parsed.windows.length > 0 ? (
                              <p className="text-emerald-300">
                                ✓ 配置に反映：{parsed.windows.map(describeMemberWindow).join(" ／ ")}
                              </p>
                            ) : (
                              <p className="text-slate-500">配置には反映されません（日時と「不可」「のみ可」などが読み取れませんでした）</p>
                            )}
                            {parsed.unrecognized.length > 0 && (
                              <p className="text-amber-400">
                                ⚠ 不可か可能か読み取れない行：{parsed.unrecognized.join(" ／ ")}
                              </p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    <button
                      type="button"
                      onClick={() => setMemberNote(m.name, "")}
                      className="min-h-11 shrink-0 rounded border border-rose-700 px-2 text-xs text-rose-300 hover:bg-rose-950/50 md:min-h-0 md:py-1"
                    >
                      削除
                    </button>
                  </div>
                ))}
            </section>
          )}

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
