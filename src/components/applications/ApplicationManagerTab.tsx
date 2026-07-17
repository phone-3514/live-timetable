import { useState } from "react";
import { useApplicationStore } from "../../store/useApplicationStore";
import { ApplicationImportPanel } from "./ApplicationImportPanel";
import { MemberFrameCounts } from "./MemberFrameCounts";
import { ApplicationTable } from "./ApplicationTable";
import { RejectConfirmModal } from "./RejectConfirmModal";
import type { Application } from "../../types";

export function ApplicationManagerTab() {
  const applications = useApplicationStore((s) => s.applications);
  const approveApplication = useApplicationStore((s) => s.approveApplication);
  const unapproveApplication = useApplicationStore((s) => s.unapproveApplication);
  const removeApplication = useApplicationStore((s) => s.removeApplication);
  const clearAll = useApplicationStore((s) => s.clearAll);

  const [pendingReject, setPendingReject] = useState<Application | null>(null);

  function handleReset() {
    if (applications.length === 0) return;
    const ok = window.confirm(
      "エントリー初期化: 貼り付けたテキスト・解析済みの全申し込み・承認済みバンドのタイムテーブルへの反映をすべて削除します。この操作は取り消せません。よろしいですか？",
    );
    if (ok) clearAll();
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[340px_1fr]">
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <ApplicationImportPanel />
        <MemberFrameCounts applications={applications} />
        <button
          type="button"
          onClick={handleReset}
          disabled={applications.length === 0}
          className="self-start rounded border border-red-800 px-3 py-1 text-xs font-medium text-red-400 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          エントリー初期化
        </button>
      </div>

      <div className="flex min-h-0 flex-col overflow-hidden">
        <h2 className="mb-2 shrink-0 text-xs font-semibold text-slate-400">
          出演申し込み一覧（{applications.length}件）
        </h2>
        <ApplicationTable
          applications={applications}
          onApprove={approveApplication}
          onUnapprove={unapproveApplication}
          onRequestReject={setPendingReject}
        />
      </div>

      {pendingReject && (
        <RejectConfirmModal
          app={pendingReject}
          allApplications={applications}
          onCancel={() => setPendingReject(null)}
          onConfirm={() => {
            removeApplication(pendingReject.id);
            setPendingReject(null);
          }}
        />
      )}
    </div>
  );
}
