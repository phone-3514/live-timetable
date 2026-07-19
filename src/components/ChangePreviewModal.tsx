import type { ScheduleChangePreview } from "../utils/scheduleChangePreview";
import { ModalPortal } from "./ModalPortal";
import { useEscapeKey } from "../hooks/useEscapeKey";

export function ChangePreviewModal({ preview, title, onConfirm, onClose }: {
  preview: ScheduleChangePreview;
  title: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEscapeKey(onClose);
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[80] overflow-y-auto bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={onClose}>
        <div className="flex min-h-full items-center justify-center">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-semibold text-blue-300">変更前プレビュー</p><h2 className="mt-1 text-lg font-bold text-slate-100">{title}</h2></div>
              <button type="button" onClick={onClose} aria-label="閉じる" className="flex h-10 w-10 items-center justify-center rounded-full text-xl text-slate-400 hover:bg-slate-700">×</button>
            </div>
            <section className="mt-4 rounded-lg border border-slate-700 p-3">
              <h3 className="text-sm font-semibold text-slate-200">変更される時刻（{preview.timeChanges.length}件）</h3>
              <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto text-xs text-slate-300">
                {preview.timeChanges.map((change) => <li key={`${change.label}-${change.before}`} className="flex justify-between gap-3"><span className="truncate">{change.label}</span><span className="shrink-0 font-mono"><s className="text-slate-500">{change.before}</s> → <strong className="text-blue-300">{change.after}</strong></span></li>)}
              </ul>
            </section>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <section className="rounded-lg border border-slate-700 p-3"><h3 className="text-xs font-semibold text-slate-400">影響を受ける出演者</h3><p className="mt-1 text-sm text-slate-200">{preview.affectedMembers.length ? preview.affectedMembers.join("、") : "なし"}</p></section>
              <section className="rounded-lg border border-slate-700 p-3"><h3 className="text-xs font-semibold text-slate-400">終演予定時刻</h3><p className="mt-1 font-mono text-base text-slate-200">{preview.previousEndTime} → <strong className="text-blue-300">{preview.nextEndTime}</strong></p></section>
            </div>
            <section className={`mt-3 rounded-lg border p-3 ${preview.newConsecutivePerformances.length ? "border-rose-700 bg-rose-950/20" : "border-emerald-800 bg-emerald-950/20"}`}>
              <h3 className="text-xs font-semibold text-slate-300">新しく発生する連続出演</h3>
              <p className={`mt-1 text-sm ${preview.newConsecutivePerformances.length ? "text-rose-300" : "text-emerald-300"}`}>{preview.newConsecutivePerformances.length ? preview.newConsecutivePerformances.join("、") : "なし"}</p>
            </section>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-slate-600 px-4 text-sm text-slate-300 hover:bg-slate-700">キャンセル</button><button type="button" onClick={onConfirm} className="min-h-11 rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white hover:bg-blue-600">この変更を確定</button></div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
