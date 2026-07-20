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

function delayLabel(minutes: number) {
  if (minutes > 0) return `${minutes}分遅れ`;
  if (minutes < 0) return `予定より${Math.abs(minutes)}分早い`;
  return "定刻";
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
  const previous = selectedDay.slots[selectedIndex - 1];
  const current = selectedDay.slots[selectedIndex];
  const next = selectedDay.slots[selectedIndex + 1];
  const afterNext = selectedDay.slots[selectedIndex + 2];
  const isProgressActive = progress.slotId !== null;
  const currentDelay = current.delayMinutes ?? 0;
  const currentDuration = (() => {
    const start = timeToMinutes(current.startTime);
    const end = timeToMinutes(current.endTime);
    return end >= start ? end - start : end + 24 * 60 - start;
  })();

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

  function stopProgress() {
    setPending(null);
    progress.setProgress(
      { dayId: selectedDay.id, slotId: null, phase: "standby" },
      actor,
      "進行モードを停止",
    );
    setExpanded(false);
  }

  function endCurrentPerformance() {
    progress.setProgress(
      { dayId: selectedDay.id, slotId: current.id, phase: "transition" },
      actor,
      "出演終了・転換開始",
    );
  }

  const primaryAction = progress.phase === "finished"
    ? {
        label: "本日の進行は終了しました",
        description: "必要な場合は進行を停止し、通常の編集画面へ戻れます。",
        disabled: true,
        run: () => undefined,
        className: "bg-slate-700",
      }
    : !isProgressActive || progress.phase === "standby"
    ? {
        label: current.bandId ? "▶ 出演を開始" : "▶ この枠を開始",
        description: "現在時刻に合わせて開始し、公開画面・会場表示・PAへ反映します。",
        disabled: false,
        run: () => adjustToNow(current, "開始時刻を現在に補正", phaseForSlot(current)),
        className: "bg-emerald-600 hover:bg-emerald-500",
      }
    : progress.phase === "transition"
      ? {
          label: next ? "✓ 転換完了・次を開始" : "次の出演はありません",
          description: next
            ? "次の枠を現在時刻から開始し、進行位置を一つ先へ進めます。"
            : "本日の最後の枠です。必要に応じて進行を停止してください。",
          disabled: !next,
          run: () => { if (next) adjustToNow(next, "転換完了・次の枠を開始", phaseForSlot(next)); },
          className: "bg-blue-600 hover:bg-blue-500",
        }
      : {
          label: current.bandId ? "■ 出演を終了" : "■ この枠を終了",
          description: "現在の枠を終了して転換中にします。次の出演はまだ開始しません。",
          disabled: false,
          run: endCurrentPerformance,
          className: "bg-amber-600 hover:bg-amber-500",
        };

  return (
    <section className="shrink-0 overflow-hidden rounded-2xl border border-blue-800/70 bg-slate-900 shadow-lg shadow-slate-950/20" aria-label="ステージ進行リモコン">
      <div className="border-b border-slate-700/80 bg-slate-950/35 p-3 md:p-4">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-400">Live Show Control</p>
            <div className="mt-1 flex min-w-0 items-center gap-2">
              <h2 className="shrink-0 text-sm font-black text-slate-100">運営リモコン</h2>
              <span className={`truncate rounded-full border px-2 py-0.5 text-[11px] font-bold ${isProgressActive ? "border-blue-700 bg-blue-950/60 text-blue-200" : "border-slate-600 bg-slate-800 text-slate-400"}`}>{isProgressActive ? PHASE_LABEL[progress.phase] : "進行停止中"}</span>
            </div>
          </div>
          <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-label={expanded ? "運営コンソールを閉じる" : "運営コンソールを開く"} className="min-h-11 shrink-0 rounded-xl border border-slate-600 px-3 text-xs font-bold text-slate-300 hover:bg-slate-800">{expanded ? "コンソールを閉じる ▲" : "詳細を開く ▼"}</button>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(16rem,0.72fr)] md:items-center">
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-blue-300">CURRENT PERFORMANCE</p>
            <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              <strong className="min-w-0 truncate text-2xl font-black tracking-tight text-white md:text-3xl">{slotLabel(current, bandNames)}</strong>
              <span className="shrink-0 font-mono text-sm font-bold text-slate-400">{current.startTime}–{current.endTime}</span>
              <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-black ${currentDelay > 0 ? "bg-rose-950/70 text-rose-300" : currentDelay < 0 ? "bg-sky-950/70 text-sky-300" : "bg-emerald-950/70 text-emerald-300"}`}>{delayLabel(currentDelay)}</span>
            </div>
          </div>
          <div>
            <button type="button" disabled={primaryAction.disabled} onClick={primaryAction.run} className={`min-h-14 w-full rounded-xl px-4 text-base font-black text-white shadow-lg transition-colors disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 ${primaryAction.className}`}>{primaryAction.label}</button>
            <p className="mt-1.5 text-xs leading-5 text-slate-400">{primaryAction.description}</p>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="grid max-h-[52dvh] gap-3 overflow-y-auto overscroll-contain p-3 md:max-h-[58dvh] md:grid-cols-12 md:p-4">
          <div className="grid gap-3 md:col-span-8">
            <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-950/35 p-2 text-xs font-bold text-slate-400 md:hidden">
              進行する日程
              <select value={selectedDay.id} onChange={(event) => { const day = days.find((item) => item.id === event.target.value); const slot = day?.slots[0]; if (day && slot) progress.setProgress({ dayId: day.id, slotId: isProgressActive ? slot.id : null, phase: "standby" }, actor, "進行日を変更"); }} className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-800 px-2 text-sm text-slate-200">
                {availableDays.map((day) => <option key={day.id} value={day.id}>{day.label}</option>)}
              </select>
            </label>
            <section className="rounded-xl border border-slate-700 bg-slate-800/45 p-3" aria-labelledby="next-performance-title">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Next Performance</p>
                  <h3 id="next-performance-title" className="mt-1 truncate text-lg font-black text-slate-100">{slotLabel(next, bandNames)}</h3>
                  <p className="mt-1 font-mono text-sm text-blue-300">{next ? `開始予定 ${next.startTime}` : "次の枠はありません"}</p>
                </div>
                <div className="shrink-0 text-right"><p className="text-[10px] font-bold text-slate-500">その次</p><p className="mt-1 max-w-32 truncate text-xs font-semibold text-slate-300">{slotLabel(afterNext, bandNames)}</p></div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" disabled={!previous} onClick={() => previous && selectSlot(previous.id)} className="min-h-12 rounded-xl border border-slate-600 px-3 text-sm font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-40">← 前の枠へ<span className="mt-0.5 block text-[10px] font-normal text-slate-500">進行位置を一つ戻します</span></button>
                <button type="button" disabled={!next} onClick={() => next && selectSlot(next.id)} className="min-h-12 rounded-xl border border-blue-700 bg-blue-950/30 px-3 text-sm font-bold text-blue-200 hover:bg-blue-900/40 disabled:opacity-40">次の枠へ →<span className="mt-0.5 block text-[10px] font-normal text-blue-300/70">現在位置をスキップして進めます</span></button>
              </div>
            </section>

            <section className="rounded-xl border border-slate-700 p-3" aria-labelledby="live-actions-title">
              <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Live Actions</p><h3 id="live-actions-title" className="mt-0.5 text-sm font-black text-slate-100">進行操作</h3></div><span className="text-[10px] text-slate-500">操作内容は公開・会場・PAへ同期</span></div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <button type="button" onClick={() => adjustToNow(current, "開始時刻を現在に補正", phaseForSlot(current))} className="min-h-14 rounded-xl border border-emerald-700 bg-emerald-950/35 px-3 text-sm font-black text-emerald-200 hover:bg-emerald-900/50">▶ 出演開始<span className="mt-1 block text-[10px] font-normal text-emerald-300/70">現在時刻に合わせて開始</span></button>
                <button type="button" onClick={endCurrentPerformance} className="min-h-14 rounded-xl border border-amber-700 bg-amber-950/35 px-3 text-sm font-black text-amber-200 hover:bg-amber-900/50">■ 出演終了<span className="mt-1 block text-[10px] font-normal text-amber-300/70">転換中へ切り替え</span></button>
                <button type="button" disabled={!next} onClick={() => next && adjustToNow(next, "転換完了・次の枠を開始", phaseForSlot(next))} className="col-span-2 min-h-14 rounded-xl border border-blue-700 bg-blue-950/35 px-3 text-sm font-black text-blue-200 hover:bg-blue-900/50 disabled:opacity-40 sm:col-span-1">✓ 転換完了<span className="mt-1 block text-[10px] font-normal text-blue-300/70">次の出演を開始</span></button>
              </div>
            </section>

            <section className="rounded-xl border border-slate-700 p-3" aria-labelledby="schedule-adjust-title">
              <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Schedule Adjustment</p>
              <h3 id="schedule-adjust-title" className="mt-0.5 text-sm font-black text-slate-100">時刻補正</h3>
              <p className="mt-1 text-xs text-slate-500">選択中の枠以降へ自動で波及します。確定前に影響範囲を確認できます。</p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <button type="button" onClick={() => openAdjustment(current.id, -5, "選択位置以降を5分早める")} className="min-h-12 rounded-xl border border-sky-700 px-3 text-sm font-black text-sky-200 hover:bg-sky-950/50">−5分<span className="mt-0.5 block text-[10px] font-normal text-slate-500">予定を早める</span></button>
                <button type="button" onClick={() => openAdjustment(current.id, 1, "選択位置以降を1分遅らせる")} className="min-h-12 rounded-xl border border-slate-600 px-3 text-sm font-black text-slate-200 hover:bg-slate-700">+1分<span className="mt-0.5 block text-[10px] font-normal text-slate-500">微調整する</span></button>
                <button type="button" onClick={() => openAdjustment(current.id, 5, "選択位置以降を5分遅らせる")} className="min-h-12 rounded-xl border border-rose-800 px-3 text-sm font-black text-rose-200 hover:bg-rose-950/50">+5分<span className="mt-0.5 block text-[10px] font-normal text-slate-500">予定を遅らせる</span></button>
                <button type="button" onClick={() => openAdjustment(current.id, null, "選択位置以降を定刻へ戻す")} className="min-h-12 rounded-xl border border-slate-600 px-3 text-sm font-black text-slate-200 hover:bg-slate-700">定刻へ戻す<span className="mt-0.5 block text-[10px] font-normal text-slate-500">補正を解除する</span></button>
              </div>
            </section>
          </div>

          <aside className="grid content-start gap-3 md:col-span-4">
            <section className="hidden rounded-xl border border-slate-700 bg-slate-950/35 p-3 md:block">
              <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Event Status</p><h3 className="mt-0.5 text-sm font-black text-slate-100">進行状況</h3></div><select value={selectedDay.id} onChange={(event) => { const day = days.find((item) => item.id === event.target.value); const slot = day?.slots[0]; if (day && slot) progress.setProgress({ dayId: day.id, slotId: isProgressActive ? slot.id : null, phase: "standby" }, actor, "進行日を変更"); }} aria-label="進行する日程" className="min-h-11 rounded-lg border border-slate-600 bg-slate-800 px-2 text-sm text-slate-200 md:min-h-9">
                {availableDays.map((day) => <option key={day.id} value={day.id}>{day.label}</option>)}
              </select></div>
              <dl className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-slate-800 p-2.5"><dt className="text-[10px] font-bold text-slate-500">現在の進み</dt><dd className={`mt-1 text-sm font-black ${currentDelay > 0 ? "text-rose-300" : currentDelay < 0 ? "text-sky-300" : "text-emerald-300"}`}>{delayLabel(currentDelay)}</dd></div>
                <div className="rounded-lg bg-slate-800 p-2.5"><dt className="text-[10px] font-bold text-slate-500">現在枠の予定時間</dt><dd className="mt-1 text-sm font-black text-slate-200">{currentDuration}分</dd></div>
                <div className="col-span-2 rounded-lg bg-slate-800 p-2.5"><dt className="text-[10px] font-bold text-slate-500">本日の終演予定</dt><dd className="mt-1 font-mono text-sm font-black text-slate-200">{selectedDay.slots.at(-1)?.endTime ?? "—"}</dd></div>
              </dl>
            </section>

            <section className="rounded-xl border border-blue-900/80 bg-blue-950/20 p-3">
              <p className="text-[10px] font-black uppercase tracking-[0.15em] text-blue-400">Affected Screens</p>
              <h3 className="mt-0.5 text-sm font-black text-slate-100">この操作の反映先</h3>
              <ul className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-300">
                {["公開パンフレット", "会場スクリーン", "PA／ローディー", "出演者通知"].map((label) => <li key={label} className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-2"><span className="text-emerald-400" aria-hidden="true">✓</span>{label}</li>)}
              </ul>
              <p className="mt-2 text-[10px] leading-4 text-slate-500">進行状況はリアルタイムで共有され、通知は出演者の設定と現在位置に応じて自動判定されます。</p>
            </section>

            <button type="button" onClick={stopProgress} disabled={!isProgressActive} className="min-h-12 rounded-xl border border-rose-800 bg-rose-950/30 px-3 text-sm font-black text-rose-300 hover:bg-rose-900/40 disabled:cursor-not-allowed disabled:opacity-40">■ 進行モードを停止<span className="mt-1 block text-[10px] font-normal text-rose-300/70">公開データを消さず、現在位置の送信を止めます</span></button>
          </aside>
        </div>
      )}

      {pending && <ChangePreviewModal preview={pending.preview} title={pending.title} onConfirm={confirmAdjustment} onClose={() => setPending(null)} />}
    </section>
  );
}
