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
  const approveAllPending = useApplicationStore((s) => s.approveAllPending);
  const removeApplication = useApplicationStore((s) => s.removeApplication);
  const clearAll = useApplicationStore((s) => s.clearAll);

  const [pendingReject, setPendingReject] = useState<Application | null>(null);
  const [filterText, setFilterText] = useState("");

  const pendingCount = applications.filter((a) => !a.approved).length;

  function handleReset() {
    if (applications.length === 0) return;
    const ok = window.confirm(
      "エントリー初期化: 貼り付けたテキスト・解析済みの全申し込み・承認済みバンドのタイムテーブルへの反映をすべて削除します。この操作は取り消せません。よろしいですか？",
    );
    if (ok) clearAll();
  }

  function handleApproveAll() {
    if (pendingCount === 0) return;
    const ok = window.confirm(
      `一括承認: 現在未承認の${pendingCount}件のバンドをすべて承認し、タイムテーブルの未配置リストに追加します。よろしいですか？`,
    );
    if (ok) approveAllPending();
  }

  // Clicking an already-selected member chip clears the filter again
  // instead of re-applying the same one (a toggle, not a one-way action).
  function handleSelectMember(name: string) {
    setFilterText((current) => (current === name ? "" : name));
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[340px_1fr]">
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <ApplicationImportPanel />
        <MemberFrameCounts
          applications={applications}
          selectedMember={filterText || null}
          onSelectMember={handleSelectMember}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleApproveAll}
            disabled={pendingCount === 0}
            className="self-start rounded border border-indigo-600 px-3 py-1 text-xs font-medium text-indigo-300 hover:bg-indigo-950/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            一括承認（未承認{pendingCount}件）
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={applications.length === 0}
            className="self-start rounded border border-red-800 px-3 py-1 text-xs font-medium text-red-400 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            エントリー初期化
          </button>
        </div>
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
          filterText={filterText}
          onFilterTextChange={setFilterText}
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
