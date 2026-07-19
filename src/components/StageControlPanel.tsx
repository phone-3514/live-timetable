import { useMemo, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useProgressStore, type StagePhase } from "../store/useProgressStore";
import { useCollabStore } from "../store/useCollabStore";
import { setNextHistoryAction } from "../store/useHistoryStore";
import { alignTimeToReference } from "../utils/scheduleTimes";
import { timeToMinutes } from "../utils/time";
import { previewScheduleAdjustment, type ScheduleChangePreview } from "../utils/scheduleChangePreview";
import { ChangePreviewModal } from "./ChangePreviewModal";

type PendingAdjustment = {
  dayId: string;
  slotId: string;
  delta: number | null;
  title: string;
  preview: ScheduleChangePreview;
  phaseAfter?: StagePhase;
  progressSlotId?: string;
};

const PHASE_LABEL: Record<StagePhase, string> = {
  standby: "待機中",
  performing: "出演中",
  transition: "転換中",
  break: "休憩・イベント中",
  finished: "終演",
};

function slotLabel(slot: { bandId: string | null; customLabel: string | null } | undefined, bandNames: Map<string, string>) {
  if (!slot) return "—";
  return (slot.bandId && bandNames.get(slot.bandId)) || slot.customLabel || "空き枠";
}

export function StageControlPanel() {
  const days = useAppStore((state) => state.days);
  const bands = useAppStore((state) => state.bands);
  const adjustScheduleFrom = useAppStore((state) => state.adjustScheduleFrom);
  const resetScheduleFrom = useAppStore((state) => state.resetScheduleFrom);
  const progress = useProgressStore();
  const actor = useCollabStore((state) => state.myNickname) || "この端末";
  const [pending, setPending] = useState<PendingAdjustment | null>(null);
  const [expanded, setExpanded] = useState(false);
  const bandNames = useMemo(() => new Map(bands.map((band) => [band.id, band.name])), [bands]);
  const availableDays = days.filter((day) => day.slots.length > 0);
  const selectedDay = availableDays.find((day) => day.id === progress.dayId) ?? availableDays[0];
  if (!selectedDay) return null;
  const selectedIndex = Math.max(0, selectedDay.slots.findIndex((slot) => slot.id === progress.slotId));
  const current = selectedDay.slots[selectedIndex];
  const next = selectedDay.slots[selectedIndex + 1];
  const afterNext = selectedDay.slots[selectedIndex + 2];

  function phaseForSlot(slot: typeof current): StagePhase {
    if (!slot) return "finished";
    return slot.bandId ? "performing" : "break";
  }

  function openAdjustment(targetSlotId: string, delta: number | null, title: string, phaseAfter?: StagePhase, progressSlotId?: string) {
    const result = previewScheduleAdjustment(selectedDay, bands, targetSlotId, delta);
    if (!result) return;
    if (result.preview.timeChanges.length === 0) {
      if (phaseAfter) progress.setProgress({ dayId: selectedDay.id, slotId: progressSlotId ?? targetSlotId, phase: phaseAfter }, actor, title);
      return;
    }
    setPending({ dayId: selectedDay.id, slotId: targetSlotId, delta, title, preview: result.preview, phaseAfter, progressSlotId });
  }

  function adjustToNow(targetSlot: typeof current, title: string, phaseAfter: StagePhase) {
    const now = new Date();
    const scheduled = timeToMinutes(targetSlot.startTime);
    const alignedNow = alignTimeToReference(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`, scheduled);
    openAdjustment(targetSlot.id, alignedNow - scheduled, title, phaseAfter, targetSlot.id);
  }

  function confirmAdjustment() {
    if (!pending) return;
    setNextHistoryAction(pending.title, actor);
    if (pending.delta === null) resetScheduleFrom(pending.dayId, pending.slotId);
    else adjustScheduleFrom(pending.dayId, pending.slotId, pending.delta);
    if (pending.phaseAfter) {
      progress.setProgress({ dayId: pending.dayId, slotId: pending.progressSlotId ?? pending.slotId, phase: pending.phaseAfter }, actor, pending.title);
    }
    setPending(null);
  }

  function selectSlot(slotId: string) {
    const slot = selectedDay.slots.find((candidate) => candidate.id === slotId);
    progress.setProgress({ dayId: selectedDay.id, slotId, phase: slot ? phaseForSlot(slot) : "standby" }, actor, "進行位置を変更");
  }

  return (
    <section className="shrink-0 rounded-xl border border-blue-800/70 bg-slate-900 p-3 shadow-sm" aria-label="ステージ進行リモコン">
      <div className="flex flex-wrap items-center gap-2">
        <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-400">Stage Control</p><h2 className="text-sm font-bold text-slate-100">運営リモコン</h2></div>
        <span className="rounded-full border border-blue-700 bg-blue-950/50 px-2 py-1 text-xs font-semibold text-blue-200">{PHASE_LABEL[progress.phase]}</span>
        {expanded && <select value={selectedDay.id} onChange={(event) => { const day = days.find((item) => item.id === event.target.value); const slot = day?.slots[0]; if (day && slot) progress.setProgress({ dayId: day.id, slotId: slot.id, phase: "standby" }, actor, "進行日を変更"); }} className="ml-auto min-h-11 rounded-lg border border-slate-600 bg-slate-800 px-2 text-sm text-slate-200 md:min-h-0 md:py-1">
          {availableDays.map((day) => <option key={day.id} value={day.id}>{day.label}</option>)}
        </select>}
        <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} className={`${expanded ? "ml-0" : "ml-auto"} min-h-11 rounded-lg border border-blue-600 px-3 text-xs font-bold text-blue-200 hover:bg-blue-950/50 md:min-h-0 md:py-1.5`}>{expanded ? "進行モードを閉じる" : "進行モードを開く"}</button>
      </div>

      {expanded && <>
      <div className="mt-3 grid grid-cols-[1.4fr_1fr_1fr] gap-2">
        {[{ caption: "現在", slot: current, emphasized: true }, { caption: "次", slot: next, emphasized: false }, { caption: "その次", slot: afterNext, emphasized: false }].map(({ caption, slot, emphasized }) => (
          <button key={caption} type="button" disabled={!slot} onClick={() => slot && selectSlot(slot.id)} className={`min-w-0 rounded-lg border p-2 text-left ${emphasized ? "border-blue-500 bg-blue-950/40" : "border-slate-700 bg-slate-800/60"} disabled:opacity-40`}>
            <span className={`block text-[10px] font-bold ${emphasized ? "text-blue-300" : "text-slate-500"}`}>{caption}</span>
            <strong className={`${emphasized ? "text-base" : "text-sm"} mt-1 block truncate text-slate-100`}>{slotLabel(slot, bandNames)}</strong>
            <span className="mt-0.5 block font-mono text-xs text-slate-400">{slot ? `${slot.startTime}〜${slot.endTime}` : "—"}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        <button type="button" onClick={() => adjustToNow(current, "開始時刻を現在に補正", phaseForSlot(current))} className="min-h-11 rounded-lg bg-emerald-700 px-2 text-sm font-bold text-white hover:bg-emerald-600">▶ 開始</button>
        <button type="button" onClick={() => progress.setProgress({ dayId: selectedDay.id, slotId: current.id, phase: "transition" }, actor, "出演終了・転換開始")} className="min-h-11 rounded-lg border border-amber-600 bg-amber-950/40 px-2 text-sm font-bold text-amber-200 hover:bg-amber-900/50">■ 終了</button>
        <button type="button" disabled={!next} onClick={() => next && adjustToNow(next, "転換完了・次の枠を開始", phaseForSlot(next))} className="min-h-11 rounded-lg border border-blue-600 bg-blue-950/40 px-2 text-sm font-bold text-blue-200 hover:bg-blue-900/50 disabled:opacity-40">✓ 転換完了</button>
        <button type="button" onClick={() => openAdjustment(current.id, 1, "選択位置以降を1分遅らせる")} className="min-h-11 rounded-lg border border-slate-600 px-2 text-sm font-semibold text-slate-200 hover:bg-slate-700">+1分</button>
        <button type="button" onClick={() => openAdjustment(current.id, 5, "選択位置以降を5分遅らせる")} className="min-h-11 rounded-lg border border-slate-600 px-2 text-sm font-semibold text-slate-200 hover:bg-slate-700">+5分</button>
        <button type="button" onClick={() => openAdjustment(current.id, null, "選択位置以降を定刻へ戻す")} className="min-h-11 rounded-lg border border-slate-600 px-2 text-sm font-semibold text-slate-300 hover:bg-slate-700">定刻へ戻す</button>
      </div>

      </>}

      {pending && <ChangePreviewModal preview={pending.preview} title={pending.title} onConfirm={confirmAdjustment} onClose={() => setPending(null)} />}
    </section>
  );
}
