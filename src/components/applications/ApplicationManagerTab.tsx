import { useMemo, useState } from "react";
import { computeMemberFrameCounts, useApplicationStore } from "../../store/useApplicationStore";
import { useIsMobile } from "../../hooks/useViewport";
import { useToastStore } from "../../store/useToastStore";
import { ApplicationImportPanel } from "./ApplicationImportPanel";
import { MemberFrameCounts } from "./MemberFrameCounts";
import { ApplicationTable } from "./ApplicationTable";
import { RejectConfirmModal } from "./RejectConfirmModal";
import { NameResolutionModal } from "./NameResolutionModal";
import { findNearDuplicateNames } from "../../utils/nameResolution";
import type { Application } from "../../types";

export function ApplicationManagerTab() {
  const isMobile = useIsMobile();
  const applications = useApplicationStore((s) => s.applications);
  const approveApplication = useApplicationStore((s) => s.approveApplication);
  const unapproveApplication = useApplicationStore((s) => s.unapproveApplication);
  const approveAllPending = useApplicationStore((s) => s.approveAllPending);
  const removeApplication = useApplicationStore((s) => s.removeApplication);
  const removeExactDuplicateApplications = useApplicationStore(
    (s) => s.removeExactDuplicateApplications,
  );
  const clearAll = useApplicationStore((s) => s.clearAll);
  const showToast = useToastStore((s) => s.show);

  const [pendingReject, setPendingReject] = useState<Application | null>(null);
  const [filterText, setFilterText] = useState("");
  const [showNameResolution, setShowNameResolution] = useState(false);

  // Computed once here and shared by MemberFrameCounts (per-member chips)
  // and ApplicationTable (per-band high-participation counts) instead of
  // each independently re-scanning every application — an update to any
  // one band's status still instantly recomputes this (it's a plain
  // useMemo keyed on applications), just without the duplicated work.
  const frameCounts = useMemo(() => computeMemberFrameCounts(applications), [applications]);

  const pendingCount = applications.filter((a) => !a.approved).length;
  // Cheap enough (O(n²) over a few dozen–hundred unique names, see
  // findNearDuplicateNames) to recompute on every applications change just
  // for the header badge's count, without threading the full pair list
  // down — NameResolutionModal recomputes the same thing itself once open.
  const nearDuplicateCount = useMemo(
    () => findNearDuplicateNames(frameCounts).length,
    [frameCounts],
  );
  // Optimistic count for the button badge — every raw text appearing more
  // than once, minus one kept copy per group. The store action recomputes
  // this itself when actually run (and separates out any group that isn't
  // safe to auto-resolve), so this only needs to answer "is there anything
  // to clean up," not match its exact removed-count precisely.
  const exactDuplicateCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const app of applications) counts.set(app.raw, (counts.get(app.raw) ?? 0) + 1);
    let extra = 0;
    for (const count of counts.values()) {
      if (count > 1) extra += count - 1;
    }
    return extra;
  }, [applications]);

  function handleRemoveDuplicates() {
    const { removed, needsManualReview } = removeExactDuplicateApplications();
    if (removed === 0 && needsManualReview === 0) return;
    const reviewNote =
      needsManualReview > 0
        ? `（${needsManualReview}件は両方承認済みのため手動で確認してください）`
        : "";
    showToast(
      removed > 0
        ? `重複した申し込み${removed}件を削除しました${reviewNote}`
        : `重複を検出しましたが両方承認済みのため自動削除できませんでした（${needsManualReview}件、手動で確認してください）`,
      removed > 0 ? "success" : "info",
    );
  }

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
    <div className="flex flex-1 flex-col md:min-h-0 md:overflow-hidden">
      {/* Prominent top action bar — Bulk Approve and Reset are the two
          highest-stakes, most-reached-for actions in this tab, so they sit
          right next to the page title where they're always visible with no
          scrolling, rather than buried partway down the sidebar. Distinct
          colors (solid green = primary/constructive, outlined red = a
          destructive one that still needs its own confirm dialog) so
          neither is mistakable for a routine secondary control. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-700 bg-slate-900 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-100">
          出演申し込み管理
          <span className="ml-2 font-normal text-slate-500">
            （{applications.length}件・未承認{pendingCount}件）
          </span>
        </h2>
        <span
          className="inline-flex min-h-9 items-center gap-1 rounded-full border border-indigo-500 bg-indigo-950/50 px-3 text-xs font-semibold text-indigo-200"
          title="全申し込みを通じたユニークな参加者数（同一人物の重複はカウントしません）"
        >
          👥 参加者 {frameCounts.size}名
        </span>
        {nearDuplicateCount > 0 && (
          <button
            type="button"
            onClick={() => setShowNameResolution(true)}
            className="min-h-9 rounded-full border border-amber-500 bg-amber-950/40 px-3 text-xs font-semibold text-amber-300 hover:bg-amber-900/50"
          >
            ⚠ 似た名前を確認（{nearDuplicateCount}件）
          </button>
        )}
        {exactDuplicateCount > 0 && (
          <button
            type="button"
            onClick={handleRemoveDuplicates}
            title="同じ内容の申し込み（同じファイルを2回取り込んだ場合など）を自動的に整理します。両方が承認済みのペアには触れません"
            className="min-h-9 rounded-full border border-amber-500 bg-amber-950/40 px-3 text-xs font-semibold text-amber-300 hover:bg-amber-900/50"
          >
            🧹 重複した申し込みを整理（{exactDuplicateCount}件）
          </button>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleApproveAll}
            disabled={pendingCount === 0}
            className="min-h-11 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 disabled:opacity-100"
          >
            ✓ 一括承認（{pendingCount}件）
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={applications.length === 0}
            className="min-h-11 rounded-md border-2 border-rose-600 px-4 text-sm font-semibold text-rose-400 hover:bg-rose-950/50 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-400"
          >
            🗑 エントリー初期化
          </button>
        </div>
      </div>

      {/* content-start below lg: CSS Grid's default align-content:stretch
          would otherwise split the container's full flex-1 height evenly
          across the two stacked rows once they're both in a single
          grid-cols-1 column on mobile, ballooning each row (and the gap
          between them) far past its actual content height. lg:content-normal
          restores the default at the breakpoint where the two become real
          side-by-side columns that are supposed to fill the full height. */}
      <div className="grid flex-1 content-start grid-cols-1 gap-4 p-4 md:min-h-0 md:overflow-hidden lg:content-normal lg:grid-cols-[340px_1fr]">
        <div className="flex flex-col gap-3 md:min-h-0 md:overflow-y-auto">
          {/* Discord chat-log import is a bulk-admin, desktop-centric
              workflow (drag-and-drop a file, or paste from a desktop
              clipboard) — omitted entirely on mobile, not just visually
              hidden, so no space is reserved for it and MemberFrameCounts
              below simply flows up to fill the freed space. Mobile still
              has full review/approve access to whatever was already
              imported; it just isn't where new applications get added. */}
          {!isMobile && <ApplicationImportPanel />}
          <MemberFrameCounts
            frameCounts={frameCounts}
            selectedMember={filterText || null}
            onSelectMember={handleSelectMember}
          />
        </div>

        <div className="flex flex-col md:min-h-0 md:overflow-hidden">
          <h3 className="mb-2 shrink-0 text-xs font-semibold text-slate-400">
            出演申し込み一覧（{applications.length}件）
          </h3>
          <ApplicationTable
            applications={applications}
            frameCounts={frameCounts}
            onApprove={approveApplication}
            onUnapprove={unapproveApplication}
            onRequestReject={setPendingReject}
            filterText={filterText}
            onFilterTextChange={setFilterText}
          />
        </div>
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

      {showNameResolution && (
        <NameResolutionModal
          frameCounts={frameCounts}
          onClose={() => setShowNameResolution(false)}
        />
      )}
    </div>
  );
}
