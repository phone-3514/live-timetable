import { useMemo, useState } from "react";
import { ModalPortal } from "./ModalPortal";
import { useToastStore } from "../store/useToastStore";
import { remainingCountsIfRemoved, useApplicationStore } from "../store/useApplicationStore";
import { RejectedApplicationsList } from "./applications/RejectedApplicationsList";
import { formatRejectionListText, type RejectionReason } from "../utils/rejectionReasons";
import type { PlannerBand } from "../utils/rejectionPlanner";

export type RejectedItem = { band: PlannerBand; reason: RejectionReason };

// 却下したバンド一覧: every band the 収容チェック says won't fit, each with the
// reason in one line, how many bands it is competing with, and who those are
// (and what made them the ones kept) — what the organizer needs to explain a
// rejection, with a copy button for pasting it into LINE.
export function RejectedBandsListModal({
  items,
  policyLabel,
  onShowDetail,
  onClose,
}: {
  items: RejectedItem[];
  policyLabel: string;
  onShowDetail: (bandId: string) => void;
  onClose: () => void;
}) {
  const showToast = useToastStore((s) => s.show);
  const applications = useApplicationStore((s) => s.applications);
  const rejectApplication = useApplicationStore((s) => s.rejectApplication);
  const rejectedCount = useApplicationStore((s) => (s.rejectedApplications ?? []).length);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { reason } of items) counts.set(reason.category, (counts.get(reason.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(formatRejectionListText(policyLabel, items));
      showToast("却下したバンドの一覧をコピーしました", "success");
    } catch {
      showToast("コピーできませんでした", "error");
    }
  }

  // Members who would be left with no slot at all if these bands were rejected —
  // the same warning the 却下 button gives, for the whole batch.
  function zeroedOutFor(bandIds: string[]): string[] {
    const rejecting = new Set(bandIds);
    const remaining = applications.filter((a) => !rejecting.has(a.id));
    const names = new Set<string>();
    for (const id of bandIds) {
      const app = applications.find((a) => a.id === id);
      if (!app) continue;
      for (const m of remainingCountsIfRemoved(applications, app)) {
        const stillPlays = remaining.some((a) => a.members.some((x) => x.name === m.name));
        if (!stillPlays) names.add(m.name);
      }
    }
    return [...names];
  }

  function rejectBands(bandIds: string[]) {
    if (bandIds.length === 0) return;
    const zeroed = zeroedOutFor(bandIds);
    const warning =
      zeroed.length > 0
        ? `\n\n⚠ 次のメンバーは、ほかに出演枠がなくなります：${zeroed.join("、")}`
        : "";
    const names = bandIds.map((id) => items.find((i) => i.band.id === id)?.band.name ?? id).join("、");
    const placed = bandIds.filter((id) => applications.find((a) => a.id === id)?.approved).length;
    const placedNote = placed > 0 ? `\n（承認済みの${placed}組は、タイムテーブルの配置からも外れます）` : "";
    if (!window.confirm(`${bandIds.length}組を却下します（却下済みの一覧から戻せます）。\n${names}${placedNote}${warning}`)) return;
    for (const id of bandIds) {
      const reason = items.find((i) => i.band.id === id)?.reason.headline;
      rejectApplication(id, reason);
    }
    showToast(`${bandIds.length}組を却下しました（「却下済み」から戻せます）`, "info");
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[55] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-label="却下したバンド一覧"
          className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-rose-700 bg-slate-900 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2 border-b border-slate-700 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">📋 却下したバンド一覧（{items.length}組）</h2>
              <p className="mt-0.5 text-xs text-slate-400">却下する順番の基準：{policyLabel}</p>
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

          <div className="space-y-3 overflow-y-auto px-4 py-3 text-xs text-slate-300">
            {categories.length > 0 && (
              <p className="flex flex-wrap gap-1.5">
                {categories.map(([category, count]) => (
                  <span key={category} className="rounded-full border border-rose-700 bg-rose-950/40 px-2 py-0.5 text-rose-200">
                    {category}：{count}組
                  </span>
                ))}
              </p>
            )}

            {items.length === 0 && (
              <p className="rounded border border-slate-700 px-3 py-6 text-center text-slate-500">却下の目安のバンドはありません</p>
            )}

            <ul className="space-y-2">
              {items.map(({ band, reason }) => {
                const open = expanded.has(band.id);
                return (
                  <li key={band.id} className="space-y-1.5 rounded border border-rose-800 bg-rose-950/20 p-3">
                    <p className="text-sm font-semibold text-slate-100">{band.name}</p>
                    <p className="break-words text-slate-400">日時指定：{band.specLabel}</p>
                    <p className="break-words font-medium text-rose-200">理由：{reason.headline}</p>
                    {reason.competitorCount > 0 && (
                      <p className="text-slate-400">
                        競合 {reason.competitorCount}組
                        {reason.directCount > 0 && `（うち ${reason.directCount}組がこのバンドの使える枠を直接使っています）`}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {reason.competitors.length > 0 && (
                        <button
                          type="button"
                          onClick={() => toggle(band.id)}
                          aria-expanded={open}
                          className="min-h-11 rounded border border-slate-600 px-2 text-slate-200 hover:bg-slate-800 md:min-h-0 md:py-1"
                        >
                          {open ? "競合を隠す" : "競合バンドと選ばれた理由を見る"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onShowDetail(band.id)}
                        className="min-h-11 rounded border border-rose-700 px-2 text-rose-200 hover:bg-rose-950/50 md:min-h-0 md:py-1"
                      >
                        詳しい理由
                      </button>
                      <button
                        type="button"
                        onClick={() => rejectBands([band.id])}
                        className="min-h-11 rounded bg-rose-700 px-3 font-semibold text-white hover:bg-rose-600 md:min-h-0 md:py-1"
                      >
                        このバンドを却下する
                      </button>
                    </div>
                    {open && (
                      <ul className="space-y-1">
                        {reason.competitors.map((c) => (
                          <li key={`${c.rank}-${c.name}`} className="rounded border border-slate-700 bg-slate-950/40 p-1.5">
                            <p className="break-words text-slate-100">
                              <span className="mr-1.5 text-slate-500">{c.rank}番目</span>
                              {c.name}
                              {c.direct && <span className="ml-1.5 text-[10px] text-amber-300">直接競合</span>}
                            </p>
                            {c.basis && <p className="break-words text-slate-400">選ばれた根拠：{c.basis}</p>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>

            <details className="border-t border-slate-700 pt-3">
              <summary className="cursor-pointer select-none font-semibold text-slate-400 hover:text-slate-200">
                🚫 却下済みのバンド（{rejectedCount}組）— 戻すことができます
              </summary>
              <div className="mt-2">
                <RejectedApplicationsList />
              </div>
            </details>
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-700 px-4 py-2">
            <button
              type="button"
              onClick={() => rejectBands(items.map((i) => i.band.id))}
              disabled={items.length === 0}
              className="min-h-11 rounded bg-rose-700 px-4 text-xs font-semibold text-white hover:bg-rose-600 disabled:opacity-40 md:min-h-0 md:py-1.5"
            >
              この一覧をすべて却下する（{items.length}組）
            </button>
            <button
              type="button"
              onClick={handleCopy}
              disabled={items.length === 0}
              className="min-h-11 rounded border border-slate-600 px-4 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40 md:min-h-0 md:py-1.5"
            >
              📋 テキストをコピー
            </button>
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
