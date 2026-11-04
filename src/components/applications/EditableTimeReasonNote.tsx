import { useRef, useState } from "react";
import type { Application } from "../../types";
import { useApplicationStore } from "../../store/useApplicationStore";
import { describeMemberWindow, parseMemberConstraintText } from "../../utils/memberConstraints";

// Click-to-edit 時間指定の理由メモ. The reason for a time restriction reaches
// the organizers on LINE rather than in the Discord application, so this is a
// hand-written note kept next to the 出演希望日 it explains. Saved through
// updateApplicationTimeReasonNote, which also updates the linked Band so the
// timetable shows the same note. Never part of the public pamphlet.
//
// "cell" variant: the textarea floats over the narrow table cell, anchored
// right like EditableDesiredDateTime's input. "inline" (mobile card): a normal
// full-width textarea in the flow.
export function EditableTimeReasonNote({
  app,
  variant,
}: {
  app: Application;
  variant: "cell" | "inline";
}) {
  const update = useApplicationStore((s) => s.updateApplicationTimeReasonNote);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Escape cancels without the blur that follows unmounting committing it.
  const skipCommitRef = useRef(false);
  const note = app.timeReasonNote ?? "";

  function startEditing() {
    skipCommitRef.current = false;
    setDraft(note);
    setEditing(true);
  }

  function commit() {
    if (skipCommitRef.current) return;
    update(app.id, draft);
    setEditing(false);
  }

  const textarea = (
    <textarea
      autoFocus
      rows={3}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          skipCommitRef.current = true;
          setEditing(false);
        }
      }}
      aria-label={`${app.bandName}の時間指定の理由メモ`}
      placeholder="LINEで届いた理由を手書きで（Ctrl/⌘+Enterで保存）"
      className={`rounded border border-indigo-500 bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none placeholder:text-slate-500 ${
        variant === "cell" ? "absolute right-0 top-0 z-20 w-64 shadow-lg shadow-black/40" : "min-h-11 w-full"
      }`}
    />
  );

  const parsed = note ? parseMemberConstraintText(note) : null;
  const recognition = parsed && (
    <div className="mt-0.5 space-y-0.5 text-[10px]">
      {parsed.windows.length > 0 && (
        <p className="text-emerald-300">
          ✓ 配置に反映：{parsed.windows.map(describeMemberWindow).join(" ／ ")}
        </p>
      )}
      {parsed.unrecognized.length > 0 && (
        <p className="text-amber-400">⚠ 不可か可能か読み取れない行：{parsed.unrecognized.join(" ／ ")}</p>
      )}
    </div>
  );

  const display = (
    <button
      type="button"
      onClick={startEditing}
      title="クリックして時間指定の理由メモを編集（運営だけが見られます）"
      className="group mt-1 inline-flex max-w-full items-start gap-1 rounded text-left text-[11px] text-amber-300/90 hover:text-amber-200"
    >
      <span aria-hidden="true">📝</span>
      <span className="whitespace-pre-wrap break-words">
        {note || <span className="text-slate-500">理由メモを書く</span>}
      </span>
    </button>
  );

  if (variant === "inline") {
    return (
      <div className="min-w-0">
        {editing ? textarea : display}
        {!editing && recognition}
      </div>
    );
  }
  return (
    <div className="relative">
      {display}
      {editing && textarea}
      {!editing && recognition}
    </div>
  );
}
