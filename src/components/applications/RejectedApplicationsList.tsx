import { useApplicationStore } from "../../store/useApplicationStore";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { stripAffiliationNoteForDisplay } from "../../utils/parseBands";
import { ModalPortal } from "../ModalPortal";
import { downloadRejectedCsv } from "../../utils/rejectedExport";

function formatDate(ms: number | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// 却下済みのバンド: rejected applications, each with why and when, and a button
// to put it back on the list (as 未承認) — or to delete it for good.
export function RejectedApplicationsList() {
  const rejected = useApplicationStore((s) => s.rejectedApplications) ?? [];
  const restore = useApplicationStore((s) => s.restoreRejectedApplication);
  const remove = useApplicationStore((s) => s.deleteRejectedApplication);

  if (rejected.length === 0) {
    return (
      <p className="rounded border border-slate-700 px-3 py-4 text-center text-xs text-slate-500">
        却下済みのバンドはありません
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void downloadRejectedCsv(rejected)}
        title="却下済みのバンドを、Excelなどで開けるCSVファイルとして保存します"
        className="min-h-11 rounded border border-slate-600 px-3 text-xs text-slate-200 hover:bg-slate-800 md:min-h-0 md:py-1"
      >
        📄 ファイルに出力（CSV）
      </button>
    <ul className="space-y-2">
      {rejected.map((app) => (
        <li key={app.id} className="space-y-1 rounded border border-slate-700 bg-slate-800/40 p-3 text-xs">
          <p className="text-sm font-semibold text-slate-100">{app.bandName}</p>
          <p className="break-words text-slate-400">
            {app.applicantName && `申請者：${app.applicantName} ／ `}
            出演希望日：{app.desiredDateTime || "未記入"}
          </p>
          <p className="break-words text-slate-400">
            メンバー：{app.members.map((m) => stripAffiliationNoteForDisplay(m.name)).join("、") || "なし"}
          </p>
          <p className="break-words text-rose-200">
            却下{app.rejectedAt ? `（${formatDate(app.rejectedAt)}）` : ""}：
            {app.rejectionReason || "理由の記録なし"}
          </p>
          <div className="flex gap-2 pt-0.5">
            <button
              type="button"
              onClick={() => restore(app.id)}
              className="min-h-11 rounded border border-emerald-600 bg-emerald-950/40 px-3 text-emerald-200 hover:bg-emerald-900/50 md:min-h-0 md:py-1"
            >
              ↩ 戻す
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`「${app.bandName}」を完全に削除します。元に戻せません。よろしいですか？`)) remove(app.id);
              }}
              className="min-h-11 rounded border border-rose-700 px-3 text-rose-300 hover:bg-rose-950/50 md:min-h-0 md:py-1"
            >
              完全に削除
            </button>
          </div>
        </li>
      ))}
    </ul>
    </div>
  );
}

export function RejectedApplicationsModal({ onClose }: { onClose: () => void }) {
  useEscapeKey(onClose);
  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-label="却下済みのバンド"
          className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2 border-b border-slate-700 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">🚫 却下済みのバンド</h2>
              <p className="mt-0.5 text-xs text-slate-400">「戻す」で申請一覧に未承認として戻ります。</p>
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
          <div className="overflow-y-auto px-4 py-3">
            <RejectedApplicationsList />
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
