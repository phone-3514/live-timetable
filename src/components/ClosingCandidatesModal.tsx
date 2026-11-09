import { useMemo, useState } from "react";
import { ModalPortal } from "./ModalPortal";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useAppStore } from "../store/useAppStore";
import { useApplicationStore } from "../store/useApplicationStore";
import { useCollabStore } from "../store/useCollabStore";
import { setNextHistoryAction } from "../store/useHistoryStore";
import { useToastStore } from "../store/useToastStore";
import {
  evaluateClosingCandidates,
  listClosingSlots,
  type ClosingCandidate,
} from "../utils/closingCandidates";
import { resolveBandDetail } from "../utils/setlistExport";
import { downloadClosingCandidatesExcel } from "../utils/closingCandidatesExport";
import type { TimetableDay } from "../types";

type Props = {
  day: TimetableDay;
  onClose: () => void;
};

const STATUS_STYLE: Record<ClosingCandidate["status"], { label: string; className: string }> = {
  ok: { label: "OK", className: "border-emerald-600 bg-emerald-950/40 text-emerald-300" },
  warn: { label: "注意", className: "border-amber-600 bg-amber-950/40 text-amber-300" },
  excluded: { label: "不可", className: "border-rose-700 bg-rose-950/40 text-rose-300" },
};

// 「トリ候補」— 日時指定などの絶対ハード制約を満たしてトリ(その日の最終枠。休憩
// 前など各ブロックの最後も選べる)に置けるバンドの一覧。各バンドを開くとメンバー
// とセットリストが見える。候補の行から、そのままトリに配置もできる。Excelにも出力できる。
export function ClosingCandidatesModal({ day, onClose }: Props) {
  const days = useAppStore((s) => s.days);
  const bands = useAppStore((s) => s.bands);
  const venueHours = useAppStore((s) => s.venueHours);
  const assignBandToSlot = useAppStore((s) => s.assignBandToSlot);
  const swapSlotBands = useAppStore((s) => s.swapSlotBands);

  const closingSlots = useMemo(() => listClosingSlots(day), [day]);
  const [slotId, setSlotId] = useState(() => closingSlots.find((s) => s.isFinal)?.slotId ?? "");
  const [query, setQuery] = useState("");
  const [showExcluded, setShowExcluded] = useState(false);
  const [exporting, setExporting] = useState(false);
  const allApplications = useApplicationStore((s) => s.applications);

  useEscapeKey(onClose);

  const candidates = useMemo(
    () => (slotId ? evaluateClosingCandidates(days, day.id, slotId, bands, venueHours) : []),
    [days, day.id, slotId, bands, venueHours],
  );

  const q = query.trim().toLowerCase();
  const matches = (c: ClosingCandidate) =>
    !q || c.band.name.toLowerCase().includes(q) || c.band.members.some((m) => m.toLowerCase().includes(q));
  const eligible = candidates.filter((c) => c.status !== "excluded" && matches(c));
  const excluded = candidates.filter((c) => c.status === "excluded" && matches(c));
  const totalEligible = candidates.filter((c) => c.status !== "excluded").length;
  const totalExcluded = candidates.length - totalEligible;
  const selectedSlot = closingSlots.find((s) => s.slotId === slotId);
  const currentBand = bands.find((b) => b.id === selectedSlot?.bandId);

  async function exportExcel() {
    if (!selectedSlot || exporting) return;
    setExporting(true);
    try {
      await downloadClosingCandidatesExcel({
        dayLabel: day.label,
        slotLabel: selectedSlot.label,
        slotTime: `${selectedSlot.startTime}${selectedSlot.endTime ? `–${selectedSlot.endTime}` : ""}`,
        currentBandName: currentBand?.name ?? null,
        candidates,
        applications: allApplications,
      });
    } catch (error) {
      console.error("[ClosingCandidatesModal] excel export failed", error);
      useToastStore.getState().show("Excelの出力に失敗しました", "error");
    } finally {
      setExporting(false);
    }
  }

  function place(c: ClosingCandidate) {
    if (!selectedSlot || c.swapBlocked) return;
    const swapping = c.placement !== null && currentBand !== undefined;
    const lines: string[] = [];
    if (c.warnings.length > 0) lines.push(...c.warnings.map((w) => `・${w}`));
    if (!swapping && currentBand && !c.isCurrentClosing) lines.push(`・現在のトリの${currentBand.name}は未配置に戻ります`);
    if (lines.length > 0) {
      const ok = window.confirm(`${c.band.name}を${selectedSlot.label}に配置します。\n\n${lines.join("\n")}\n\nこのまま配置しますか？`);
      if (!ok) return;
    }
    const actor = useCollabStore.getState().myNickname ?? "この端末";
    setNextHistoryAction(`${c.band.name}を${day.label}のトリに配置`, actor);
    if (swapping && c.placement) {
      // 配置済み同士は入替(時刻は動かさない)。入れ替え先はバンドの現在の枠。
      const from = days.flatMap((d) => d.slots).find((s) => s.bandId === c.band.id && s.customLabel === null);
      if (from) swapSlotBands(selectedSlot.slotId, from.id);
    } else {
      assignBandToSlot(c.band.id, selectedSlot.slotId);
    }
    useToastStore.getState().show(`${c.band.name}を${day.label}のトリに配置しました`, "success");
    onClose();
  }

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        onClick={onClose}
      >
        <div
          className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-100">🏆 {day.label}のトリ候補</h2>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg leading-none text-slate-500 hover:bg-slate-700 hover:text-slate-300"
              title="閉じる"
            >
              ×
            </button>
          </div>

          {closingSlots.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500">この日には演奏枠がありません</p>
          ) : (
            <>
              <div className="mt-1 flex items-start justify-between gap-2">
              <p className="text-[11px] text-slate-400">
                出演可能日・NG時間・希望時間・メンバーの時間指定を満たして、この枠に置けるバンドです（候補の行から、そのままトリに配置もできます）。
              </p>
              <button
                type="button"
                onClick={() => void exportExcel()}
                disabled={exporting || candidates.length === 0}
                title="いま選んでいる枠の候補（置けないバンドも含む全バンド）を、メンバー・セットリスト・理由つきでExcelに出力"
                className="min-h-11 shrink-0 rounded border border-emerald-600 bg-emerald-950/40 px-2 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-900/50 disabled:opacity-40 md:min-h-0 md:py-1"
              >
                {exporting ? "出力中…" : "📥 Excel"}
              </button>
              </div>

              <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2">
                <select
                  value={slotId}
                  onChange={(e) => setSlotId(e.target.value)}
                  aria-label="候補を調べる枠"
                  className="min-h-11 min-w-0 flex-1 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-indigo-500 md:min-h-0"
                >
                  {closingSlots.map((s) => (
                    <option key={s.slotId} value={s.slotId}>
                      {s.label} {s.startTime}
                      {s.endTime ? `–${s.endTime}` : ""}
                    </option>
                  ))}
                </select>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="バンド名・メンバーで検索"
                  aria-label="トリ候補をバンド名・メンバーで検索"
                  className="min-h-11 min-w-0 flex-1 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-indigo-500 md:min-h-0"
                />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">
                現在のこの枠: {currentBand ? currentBand.name : "未配置"}　／　全{candidates.length}バンド中　候補 {totalEligible}件＋置けない {totalExcluded}件
                {q && `（検索で候補 ${eligible.length}件・置けない ${excluded.length}件を表示）`}
              </p>

              <ul className="mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
                {eligible.length === 0 && (
                  <li className="py-6 text-center text-xs text-slate-500">この枠に置けるバンドがありません</li>
                )}
                {eligible.map((c) => (
                  <CandidateRow key={c.band.id} candidate={c} onPlace={place} />
                ))}

                {excluded.length > 0 && (
                  <li className="pt-2">
                    <button
                      type="button"
                      onClick={() => setShowExcluded((v) => !v)}
                      className="text-[11px] font-semibold text-slate-400 hover:text-slate-200"
                    >
                      {showExcluded ? "▼" : "▶"} 置けないバンド（{excluded.length}件）とその理由
                    </button>
                  </li>
                )}
                {showExcluded && excluded.map((c) => <CandidateRow key={c.band.id} candidate={c} />)}
              </ul>
            </>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}

function CandidateRow({ candidate: c, onPlace }: { candidate: ClosingCandidate; onPlace?: (c: ClosingCandidate) => void }) {
  const applications = useApplicationStore((s) => s.applications);
  const style = STATUS_STYLE[c.status];
  const { songs, members } = resolveBandDetail(c.band, applications);
  return (
    <li className="rounded-md border border-slate-700 bg-slate-800/60">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-2">
          <span className={`mt-0.5 shrink-0 rounded border px-1.5 text-[10px] font-bold ${style.className}`}>{style.label}</span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 text-xs font-semibold text-slate-100">
              <span className="break-all">{c.band.name}</span>
              <span className="text-[10px] font-normal text-amber-300">{"★".repeat(c.rating)}</span>
              {c.isCurrentClosing && (
                <span className="rounded bg-indigo-900/60 px-1 text-[10px] font-normal text-indigo-200">現在のトリ</span>
              )}
            </span>
            <span className="block text-[10px] text-slate-400">
              {c.placement ? `いま: ${c.placement.dayLabel} ${c.placement.startTime || ""}に配置済み` : c.isCurrentClosing ? "" : "未配置"}
              {c.band.durationMinutes ? `　演奏${c.band.durationMinutes}分` : ""}
              {members.length > 0 ? `　${members.length}人` : ""}
            </span>
            {c.blockers.map((r) => (
              <span key={r} className="block text-[10px] text-rose-300">✕ {r}</span>
            ))}
            {c.warnings.map((w) => (
              <span key={w} className="block text-[10px] text-amber-300">⚠ {w}</span>
            ))}
          </span>
          <span className="mt-0.5 shrink-0 text-[10px] text-slate-500 group-open:rotate-180">▼</span>
        </summary>

        <div className="space-y-2 border-t border-slate-700 px-3 py-2 text-[11px]">
          {(c.band.desiredTime.trim() || c.band.ngTime.trim() || c.band.timeReasonNote?.trim()) && (
            <div className="rounded bg-slate-900/70 px-2 py-1 text-slate-300">
              {c.band.desiredTime.trim() && <p>希望: {c.band.desiredTime.trim()}</p>}
              {c.band.ngTime.trim() && <p>NG: {c.band.ngTime.trim()}</p>}
              {c.band.timeReasonNote?.trim() && <p>メモ: {c.band.timeReasonNote.trim()}</p>}
            </div>
          )}
          {onPlace && c.status !== "excluded" && !c.isCurrentClosing && (
            <div>
              <button
                type="button"
                disabled={c.swapBlocked}
                onClick={() => onPlace(c)}
                className="min-h-11 w-full rounded border border-amber-600 bg-amber-950/40 px-3 text-xs font-semibold text-amber-200 hover:bg-amber-900/50 disabled:cursor-not-allowed disabled:opacity-40 md:min-h-0 md:py-1.5"
              >
                🏆 このバンドをトリに配置{c.placement ? "（現トリと入替）" : ""}
              </button>
              {c.swapBlocked && <p className="mt-1 text-amber-300">現トリが入れない枠のため、入替できません</p>}
            </div>
          )}
          <div>
            <p className="mb-0.5 font-semibold text-slate-400">メンバー</p>
            {members.length === 0 ? (
              <p className="text-slate-500">メンバー情報はありません</p>
            ) : (
              <ul className="space-y-0.5 text-slate-200">
                {members.map((m, i) => (
                  <li key={`${m.name}-${i}`}>
                    {m.name}
                    {(m.part || m.grade) && (
                      <span className="text-slate-500">
                        {" "}（{[m.part, m.grade].filter(Boolean).join(" / ")}）
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-0.5 font-semibold text-slate-400">セットリスト</p>
            {songs.length === 0 ? (
              <p className="text-slate-500">セットリスト情報はありません</p>
            ) : (
              <ol className="list-inside list-decimal space-y-0.5 text-slate-200">
                {songs.map((s, i) => (
                  <li key={`${s.title}-${i}`}>
                    {s.title}
                    {s.artist && <span className="text-slate-500"> / {s.artist}</span>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </details>
    </li>
  );
}
