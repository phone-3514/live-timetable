import { useState } from "react";
import { ModalPortal } from "./ModalPortal";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useAppStore } from "../store/useAppStore";
import { useCollabStore } from "../store/useCollabStore";
import { setNextHistoryAction } from "../store/useHistoryStore";
import { useToastStore } from "../store/useToastStore";
import { listSwapCandidates, type SwapCandidate } from "../utils/bandSwap";
import type { Band, TimetableSlot } from "../types";

type Props = {
  dayId: string;
  slot: TimetableSlot;
  band: Band;
  onClose: () => void;
};

// Manual cross-day "Swap band" picker — opened from SlotCard's per-slot
// button. Two-step flow: pick a candidate from the searchable list (any
// day), then either apply immediately (no warnings) or show a confirmation
// step listing every warning before applying (see bandSwap.ts's
// validateBandSwap for what counts as blocking vs. warning). Closing at
// either step (✕/backdrop/Escape) makes no state changes — the store
// action itself is only ever called from the two explicit "apply" points
// below.
export function BandSwapModal({ dayId, slot, band, onClose }: Props) {
  const days = useAppStore((s) => s.days);
  const bands = useAppStore((s) => s.bands);
  const venueHours = useAppStore((s) => s.venueHours);
  const swapSlotBands = useAppStore((s) => s.swapSlotBands);

  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState<SwapCandidate | null>(null);

  useEscapeKey(() => {
    if (confirming) {
      setConfirming(null);
    } else {
      onClose();
    }
  });

  const fromDay = days.find((d) => d.id === dayId);
  const candidates = listSwapCandidates(days, bands, venueHours, slot.id, query);

  function applySwap(candidate: SwapCandidate) {
    const actor = useCollabStore.getState().myNickname ?? "この端末";
    // Recorded as one atomic history operation — setNextHistoryAction
    // stashes the label just before the single swapSlotBands() call below,
    // which itself is one atomic store update (see useAppStore.ts).
    setNextHistoryAction(`${band.name}と${candidate.bandName}を入替`, actor);
    swapSlotBands(slot.id, candidate.slotId);
    useToastStore.getState().show(`${band.name}と${candidate.bandName}を入れ替えました`, "success");
    onClose();
  }

  function handleSelect(candidate: SwapCandidate) {
    if (!candidate.validation.canSwap) return;
    if (candidate.validation.warnings.length === 0) {
      applySwap(candidate);
      return;
    }
    setConfirming(candidate);
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
          className="flex max-h-[85vh] w-full max-w-md flex-col rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {confirming ? (
            <SwapConfirmation
              fromBandName={band.name}
              fromDayLabel={fromDay?.label ?? ""}
              fromTime={slot.startTime}
              candidate={confirming}
              onCancel={() => setConfirming(null)}
              onConfirm={() => applySwap(confirming)}
            />
          ) : (
            <>
              <div className="flex shrink-0 items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-100">🔁 {band.name} と入替</h2>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg leading-none text-slate-500 hover:bg-slate-700 hover:text-slate-300"
                  title="閉じる"
                >
                  ×
                </button>
              </div>

              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="バンド名で検索"
                aria-label="入替候補をバンド名で検索"
                className="mt-3 min-h-11 w-full shrink-0 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-indigo-500 md:min-h-0"
              />

              <ul className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto">
                {candidates.length === 0 && (
                  <li className="py-6 text-center text-xs text-slate-500">該当するバンドがありません</li>
                )}
                {candidates.map((c) => (
                  <li key={c.slotId}>
                    <button
                      type="button"
                      disabled={!c.validation.canSwap}
                      onClick={() => handleSelect(c)}
                      className={`flex min-h-11 w-full flex-col gap-0.5 rounded-md border px-3 py-2 text-left ${
                        !c.validation.canSwap
                          ? "cursor-not-allowed border-slate-800 bg-slate-900/60 opacity-50"
                          : c.validation.warnings.length > 0
                            ? "border-amber-700 bg-amber-950/10 hover:bg-amber-950/30"
                            : "border-slate-700 bg-slate-800 hover:bg-slate-700"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-100">
                        {c.bandName}
                        {c.validation.canSwap && c.validation.warnings.length > 0 && (
                          <span className="shrink-0 text-xs font-normal text-amber-400">⚠ 要確認</span>
                        )}
                      </span>
                      <span className="text-xs text-slate-400">
                        {c.dayLabel}
                        {c.dayDate ? ` · ${c.dayDate}` : ""}
                        {c.startTime && ` ・ ${c.startTime}${c.endTime ? `〜${c.endTime}` : ""}`}
                      </span>
                      {c.restrictionLabel && <span className="text-xs text-slate-500">{c.restrictionLabel}</span>}
                      {!c.validation.canSwap && (
                        <span className="text-xs font-medium text-rose-400">{c.validation.blockingReasons[0]}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}

function SwapConfirmation({
  fromBandName,
  fromDayLabel,
  fromTime,
  candidate,
  onCancel,
  onConfirm,
}: {
  fromBandName: string;
  fromDayLabel: string;
  fromTime: string;
  candidate: SwapCandidate;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <h2 className="shrink-0 text-sm font-semibold text-slate-100">⚠ 確認が必要です</h2>
      <div className="mt-3 shrink-0 space-y-1 rounded-md border border-slate-700 bg-slate-800/60 p-2.5 text-xs text-slate-300">
        <p>
          {fromBandName} → {candidate.dayLabel}
          {candidate.dayDate ? ` · ${candidate.dayDate}` : ""} {candidate.startTime}〜{candidate.endTime}
        </p>
        <p>
          {candidate.bandName} → {fromDayLabel} {fromTime}
        </p>
      </div>
      <ul className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        {candidate.validation.warnings.map((w, i) => (
          <li key={i} className="rounded border border-amber-700 bg-amber-950/20 px-2 py-1.5 text-xs text-amber-300">
            ⚠ {w}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex shrink-0 flex-col-reverse justify-end gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded border border-slate-600 px-4 text-sm font-medium text-slate-300 hover:bg-slate-700 sm:min-h-0 sm:py-1.5 sm:text-xs"
        >
          キャンセル
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="min-h-11 rounded bg-amber-600 px-4 text-sm font-medium text-white hover:bg-amber-500 sm:min-h-0 sm:py-1.5 sm:text-xs"
        >
          それでも入れ替える
        </button>
      </div>
    </>
  );
}
