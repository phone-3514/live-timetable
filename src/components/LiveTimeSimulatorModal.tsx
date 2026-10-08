import { useCallback, useMemo, useState, type SetStateAction } from "react";
import { useAppStore } from "../store/useAppStore";
import { computeMemberFrameCounts, useApplicationStore } from "../store/useApplicationStore";
import {
  useSimulatorStore,
  type SimulatorDayInput,
  type SimulatorSettings,
} from "../store/useSimulatorStore";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useToastStore } from "../store/useToastStore";
import { clearNextHistoryAction, setNextHistoryAction } from "../store/useHistoryStore";
import { planDaySlots, type PlannedDay, type SimulationPlan } from "../utils/applySimulationPlan";
import { collectScheduleCandidates, parseScheduleAvailability } from "../utils/scheduleAvailability";
import {
  canUseSlot,
  explainRejection,
  normalizeScheduleKey,
  planRejections,
  type PlannerBand,
  type PlannerSlot,
} from "../utils/rejectionPlanner";
import {
  REJECTION_POLICIES,
  comparePriority,
  computeBandMetrics,
  describePriorityBasis,
} from "../utils/rejectionPolicy";
import { ModalPortal } from "./ModalPortal";
import { RejectionReasonDialog } from "./RejectionReasonDialog";
import type { TimetableDay } from "../types";
import {
  STANDARD_SIM_EXTRAS,
  distributeAcrossDays,
  endOf,
  formatClock,
  formatDuration,
  maxBandsBeforeDeadline,
  resolveDeadline,
  simulateDay,
  slotEquivalent,
  type SimExtra,
  type SimItem,
} from "../utils/liveTimeSimulation";

type DayInput = SimulatorDayInput;

function defaultsFor(day: TimetableDay): DayInput {
  const placed = day.slots.filter((s) => s.bandId).length;
  return {
    startTime: day.settings.startTime,
    performanceMinutes: day.settings.performanceMinutes,
    transitionMinutes: day.settings.transitionMinutes,
    manualCount: placed > 0 ? placed : 10,
    deadline: "",
  };
}

function toNumber(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// No width here on purpose: Tailwind's w-full and a per-field w-16 would both
// apply and whichever lands later in the generated CSS wins, so inline rows
// (the extras editor) set an explicit width and block-level fields append
// w-full themselves via inputClass.
const fieldClass =
  "min-h-11 rounded border border-slate-600 bg-slate-800 px-2 text-sm text-slate-100 outline-none focus:border-indigo-500 md:min-h-0 md:py-1.5";
const inputClass = `${fieldClass} w-full`;

const EMPTY_EXTRAS: SimExtra[] = [];

function newStandardExtras(): SimExtra[] {
  return STANDARD_SIM_EXTRAS.map((e) => ({ ...e, id: crypto.randomUUID() }));
}

// One day's 休憩・準備などの追加項目. Each day owns its own list — the
// breaks/prep around a Saturday and a Sunday rarely match — so this renders
// inside that day's card rather than once for the whole simulator.
function ExtrasEditor({
  dayLabel,
  extras,
  canCopyToOtherDays,
  onAdd,
  onAddStandard,
  onClear,
  onPatch,
  onRemove,
  onCopyToOtherDays,
}: {
  dayLabel: string;
  extras: SimExtra[];
  canCopyToOtherDays: boolean;
  onAdd: () => void;
  onAddStandard: () => void;
  onClear: () => void;
  onPatch: (id: string, patch: Partial<SimExtra>) => void;
  onRemove: (id: string) => void;
  onCopyToOtherDays: () => void;
}) {
  const smallButton =
    "min-h-11 rounded border px-2 text-xs md:min-h-0 md:py-1";
  return (
    <div className="space-y-1.5 rounded border border-slate-700 bg-slate-900/40 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold text-slate-400">追加項目（休憩・準備など）</span>
        <button
          type="button"
          onClick={onAdd}
          className={`${smallButton} border-slate-600 text-slate-200 hover:bg-slate-700`}
        >
          + 追加
        </button>
        <button
          type="button"
          onClick={onAddStandard}
          title="幹部集合10分→出演者集合5分→リハーサル10分→諸注意5分／写真撮影5分→完全撤収60分"
          className={`${smallButton} border-violet-600 bg-violet-950/40 text-violet-300 hover:bg-violet-900/50`}
        >
          🎬 定型
        </button>
        {extras.length > 0 && canCopyToOtherDays && (
          <button
            type="button"
            onClick={onCopyToOtherDays}
            title="この日の追加項目で、他の日の追加項目を置き換えます"
            className={`${smallButton} border-slate-600 text-slate-300 hover:bg-slate-700`}
          >
            他の日へコピー
          </button>
        )}
        {extras.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className={`${smallButton} border-slate-700 text-slate-400 hover:bg-slate-700`}
          >
            すべて削除
          </button>
        )}
      </div>
      {extras.length === 0 ? (
        <p className="text-[11px] text-slate-500">
          追加項目なし。「定型」で開演前後のいつもの流れを一括追加できます。
        </p>
      ) : (
        <ul className="space-y-1.5">
          {extras.map((extra) => (
            <li key={extra.id} className="flex flex-wrap items-center gap-1.5">
              <input
                value={extra.label}
                onChange={(e) => onPatch(extra.id, { label: e.target.value })}
                aria-label={`${dayLabel}の項目名`}
                className={`${fieldClass} min-w-0 flex-1 basis-28`}
              />
              <input
                type="number"
                min={0}
                value={extra.minutes}
                onChange={(e) => onPatch(extra.id, { minutes: toNumber(e.target.value) })}
                aria-label={`${dayLabel}の${extra.label}の所要時間（分）`}
                className={`${fieldClass} w-16`}
              />
              <span className="text-xs text-slate-500">分</span>
              <select
                value={extra.position}
                onChange={(e) => onPatch(extra.id, { position: e.target.value as SimExtra["position"] })}
                aria-label={`${dayLabel}の${extra.label}の位置`}
                className={`${fieldClass} w-24`}
              >
                <option value="before">開演前</option>
                <option value="middle">途中</option>
                <option value="after">終演後</option>
              </select>
              {extra.position === "middle" && (
                <>
                  <input
                    type="number"
                    min={1}
                    value={extra.afterBandCount}
                    onChange={(e) =>
                      onPatch(extra.id, { afterBandCount: Math.max(1, toNumber(e.target.value)) })
                    }
                    aria-label={`${dayLabel}の${extra.label}を入れるバンド数`}
                    className={`${fieldClass} w-16`}
                  />
                  <span className="text-xs text-slate-500">組目の後</span>
                </>
              )}
              <button
                type="button"
                onClick={() => onRemove(extra.id)}
                className="flex h-11 w-11 items-center justify-center rounded text-slate-500 hover:text-rose-400 md:h-8 md:w-8"
                title="削除"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// useState-shaped accessor onto one field of the persisted simulator settings.
function useSim<K extends keyof SimulatorSettings>(
  key: K,
): [SimulatorSettings[K], (next: SetStateAction<SimulatorSettings[K]>) => void] {
  const value = useSimulatorStore((s) => s.settings[key]);
  const setField = useSimulatorStore((s) => s.setField);
  const set = useCallback(
    (next: SetStateAction<SimulatorSettings[K]>) => {
      const current = useSimulatorStore.getState().settings[key];
      setField(
        key,
        typeof next === "function" ? (next as (prev: SimulatorSettings[K]) => SimulatorSettings[K])(current) : next,
      );
    },
    [key, setField],
  );
  return [value, set];
}

// 全日程まとめてシミュレーション: for every day at once, "this start time +
// this many bands (typed, taken from the timetable as placed, or counted from
// the applications) + these extras ends at …", and the reverse — "to finish
// by this time, this many bands fit". All the arithmetic lives in
// liveTimeSimulation.ts, which runs on the real timetable's own time
// calculation so what's shown here matches what the timetable would show.
export function LiveTimeSimulatorModal({ onClose }: { onClose: () => void }) {
  const [reasonBandId, setReasonBandId] = useState<string | null>(null);
  // Esc closes the reason popup first, the simulator only when none is open.
  useEscapeKey(reasonBandId ? () => setReasonBandId(null) : onClose);
  const days = useAppStore((s) => s.days);
  const bands = useAppStore((s) => s.bands);
  const applications = useApplicationStore((s) => s.applications);
  const applySimulationPlans = useAppStore((s) => s.applySimulationPlans);
  const showToast = useToastStore((s) => s.show);

  // The simulator's inputs live in a persisted store (and ride along in the
  // backup file) instead of component state, so closing the modal, reloading
  // or restoring a backup brings the same simulation back.
  const [source, setSource] = useSim("source");
  const [includePending, setIncludePending] = useSim("includePending");
  const [basis, setBasis] = useSim("basis");
  const [extrasByDay, setExtrasByDay] = useSim("extrasByDay");
  // "タイムテーブルへ反映" panel state.
  const [excludedApplyList, setExcludedApplyDays] = useSim("excludedApplyDays");
  const excludedApplyDays = useMemo(() => new Set(excludedApplyList), [excludedApplyList]);
  const [applySettings, setApplySettings] = useSim("applySettings");
  const [applyExtras, setApplyExtras] = useSim("applyExtras");
  const [slotMode, setSlotMode] = useSim("slotMode");
  const [replaceOverride, setReplaceOverride] = useSim("replaceOverride");
  // 日時指定を考慮した収容チェック: at the selection stage most applications
  // are still pending, so unlike the 申込から自動 count this includes them.
  const [plannerIncludePending, setPlannerIncludePending] = useSim("plannerIncludePending");
  const [rejectionPolicy, setRejectionPolicy] = useSim("rejectionPolicy");
  const [dayInputs, setDayInputs] = useSim("dayInputs");

  const inputFor = (day: TimetableDay): DayInput => dayInputs[day.id] ?? defaultsFor(day);
  const patchDay = (dayId: string, patch: Partial<DayInput>) =>
    setDayInputs((prev) => {
      const day = days.find((d) => d.id === dayId);
      const current = prev[dayId] ?? (day ? defaultsFor(day) : undefined);
      return current ? { ...prev, [dayId]: { ...current, ...patch } } : prev;
    });

  const extrasFor = (day: TimetableDay): SimExtra[] => extrasByDay[day.id] ?? EMPTY_EXTRAS;
  const updateExtras = (dayId: string, update: (prev: SimExtra[]) => SimExtra[]) =>
    setExtrasByDay((prev) => ({ ...prev, [dayId]: update(prev[dayId] ?? []) }));
  const copyExtrasToOtherDays = (fromDayId: string) =>
    setExtrasByDay((prev) => {
      const source = prev[fromDayId] ?? [];
      return Object.fromEntries(
        days.map((d) => [
          d.id,
          d.id === fromDayId ? source : source.map((e) => ({ ...e, id: crypto.randomUUID() })),
        ]),
      );
    });

  const bandMap = useMemo(() => new Map(bands.map((b) => [b.id, b])), [bands]);

  const sourceApplications = useMemo(
    () => applications.filter((a) => includePending || a.approved),
    [applications, includePending],
  );

  const plans = useMemo(() => {
    // The first day's *edited* values (not the saved day settings) so the
    // 枠換算/未入力フォールバック follow whatever the user has typed above.
    const first = days[0] ? inputFor(days[0]) : undefined;
    const fallbackMinutes = first?.performanceMinutes ?? 10;
    const fallbackTransition = first?.transitionMinutes ?? 10;

    // 申込から自動: spread the bands over the days. A day with a 締切 takes only
    // as many as fit before it (how the days' own finishing times compare
    // doesn't matter); days without one share the rest by load, seeded with
    // the extras each day carries.
    let assignment: number[] = [];
    if (source === "applications") {
      const dayLimits = days.map((day) => {
        const input = inputFor(day);
        if (!input.deadline) return null;
        const settings = {
          startTime: input.startTime || day.settings.startTime,
          performanceMinutes: input.performanceMinutes,
          transitionMinutes: input.transitionMinutes,
        };
        const extras = extrasFor(day);
        const start = simulateDay([], extras, settings).startMinutes;
        return maxBandsBeforeDeadline(extras, settings, resolveDeadline(input.deadline, start), basis);
      });
      assignment = distributeAcrossDays(
        sourceApplications.map((a) => a.durationMinutes ?? fallbackMinutes),
        days.map((d) => extrasFor(d).reduce((sum, e) => sum + e.minutes, 0)),
        fallbackTransition,
        {
          bandUnits: sourceApplications.map((a) =>
            slotEquivalent(a.durationMinutes ?? fallbackMinutes, fallbackMinutes),
          ),
          dayLimits,
        },
      );
    }

    return days.map((day, dayIndex) => {
      const input = inputFor(day);
      const settings = {
        startTime: input.startTime || day.settings.startTime,
        performanceMinutes: input.performanceMinutes,
        transitionMinutes: input.transitionMinutes,
      };
      const effectiveExtras = extrasFor(day);

      let core: SimItem[] = [];
      if (source === "manual") {
        core = Array.from({ length: input.manualCount }, (_, i) => ({
          kind: "band" as const,
          label: `枠${i + 1}`,
          minutes: null,
        }));
      } else if (source === "timetable") {
        for (const slot of day.slots) {
          if (slot.bandId) {
            const band = bandMap.get(slot.bandId);
            core.push({
              kind: "band",
              label: band?.name ?? "バンド",
              minutes: band?.durationMinutes ?? null,
              transitionMinutes: band?.customTransitionMinutes,
            });
          } else if (slot.customLabel !== null) {
            core.push({
              kind: "extra",
              label: slot.customLabel,
              minutes: slot.customDurationMinutes ?? input.performanceMinutes,
            });
          }
        }
      } else {
        sourceApplications.forEach((app, i) => {
          if (assignment[i] === dayIndex) {
            core.push({ kind: "band", label: app.bandName, minutes: app.durationMinutes });
          }
        });
      }

      const result = simulateDay(core, effectiveExtras, settings);
      const slotCount = core.reduce(
        (sum, item) =>
          item.kind === "band"
            ? sum + slotEquivalent(item.minutes ?? input.performanceMinutes, input.performanceMinutes)
            : sum,
        0,
      );

      let deadline: null | {
        absolute: number;
        end: number;
        margin: number;
        maxSlots: number;
      } = null;
      if (input.deadline) {
        const absolute = resolveDeadline(input.deadline, result.startMinutes);
        const end = endOf(result, basis);
        deadline = {
          absolute,
          end,
          margin: absolute - end,
          maxSlots: maxBandsBeforeDeadline(effectiveExtras, settings, absolute, basis),
        };
      }
      return { day, input, settings, extras: effectiveExtras, result, slotCount, deadline };
    });
  }, [days, dayInputs, extrasByDay, source, sourceApplications, bandMap, basis]);

  const totals = useMemo(() => {
    const withDeadline = plans.filter((p) => p.deadline !== null);
    return {
      bandCount: plans.reduce((s, p) => s + p.result.bandCount, 0),
      slotCount: plans.reduce((s, p) => s + p.slotCount, 0),
      latestEnd: plans.length > 0 ? Math.max(...plans.map((p) => endOf(p.result, basis))) : null,
      deadlineDays: withDeadline.length,
      capacity: withDeadline.reduce((s, p) => s + (p.deadline?.maxSlots ?? 0), 0),
      demandOnDeadlineDays: withDeadline.reduce((s, p) => s + p.slotCount, 0),
    };
  }, [plans, basis]);

  const baseSlotMinutes = days[0] ? inputFor(days[0]).performanceMinutes : 10;
  const applicationSummary = useMemo(() => {
    const minutes = sourceApplications.reduce((s, a) => s + (a.durationMinutes ?? baseSlotMinutes), 0);
    const slots = sourceApplications.reduce(
      (s, a) => s + slotEquivalent(a.durationMinutes ?? baseSlotMinutes, baseSlotMinutes),
      0,
    );
    return { count: sourceApplications.length, minutes, slots };
  }, [sourceApplications, baseSlotMinutes]);

  const basisLabel = basis === "lastBand" ? "最後の演奏の終了" : "撤収など最後の項目まで含めた終了";

  // 反映: with the timetable as the source, the simulated rows already include
  // the day's existing breaks, so replacing them would drop rows the result was
  // computed with — default to keeping them there, replacing in the typed/
  // application modes where the extras list is the whole intended set.
  const replaceCustom = replaceOverride ?? source !== "timetable";
  const anyDeadline = plans.some((p) => p.deadline !== null);
  const applyPreview = useMemo(
    () =>
      plans
        .filter((p) => !excludedApplyDays.has(p.day.id))
        .map((p) => {
          const slotCount =
            slotMode === "none"
              ? null
              : slotMode === "max" && p.deadline
                ? p.deadline.maxSlots
                : p.result.bandCount;
          const plan: SimulationPlan = {
            dayId: p.day.id,
            settings: applySettings ? p.settings : null,
            slotCount,
            extras: applyExtras ? p.extras : null,
            replaceCustomSlots: replaceCustom,
          };
          return { plan, label: p.day.label, planned: planDaySlots(p.day, plan) };
        }),
    [plans, excludedApplyDays, slotMode, applySettings, applyExtras, replaceCustom],
  );
  const nothingToApply = !applySettings && !applyExtras && slotMode === "none";

  // 日時指定を考慮した収容チェック. Slots are what each day with a deadline can
  // actually hold (the simulator's own uniform-slot timeline, so every slot has
  // a real start/end), bands are the applications with what their 出演希望日
  // allows; planRejections then finds the most that can be seated and which
  // schedule groups the rest come from.
  const rejectionAnalysis = useMemo(() => {
    const dayPlans = plans
      .map((p, dayIndex) => ({ p, dayIndex }))
      .filter(({ p }) => p.deadline !== null);
    if (dayPlans.length === 0) return null;

    // Member frame counts are over every application (as in the application
    // manager), not just the ones in this check.
    const frameCounts = computeMemberFrameCounts(applications);
    const candidates = applications
      .filter((a) => plannerIncludePending || a.approved)
      .map((app) => ({
        app,
        availability: parseScheduleAvailability(app.desiredDateTime),
        metrics: computeBandMetrics(app, frameCounts),
      }));
    const writtenDays = collectScheduleCandidates(candidates.map((c) => c.availability)).days;

    let guessedDates = false;
    const slots: PlannerSlot[] = [];
    for (const { p, dayIndex } of dayPlans) {
      let dayOfMonth: number | null = null;
      if (p.day.date) {
        dayOfMonth = Number(p.day.date.slice(8, 10)) || null;
      } else {
        // No calendar date on this day: line the day up with the dates the
        // applications mention, in order (1日目 = the smallest date …).
        dayOfMonth = writtenDays[dayIndex] ?? null;
        guessedDates = true;
      }
      const n = p.deadline?.maxSlots ?? 0;
      const core: SimItem[] = Array.from({ length: n }, (_, i) => ({
        kind: "band",
        label: `枠${i + 1}`,
        minutes: null,
      }));
      for (const row of simulateDay(core, p.extras, p.settings).rows) {
        if (row.kind === "band") slots.push({ dayIndex, dayOfMonth, start: row.start, end: row.end });
      }
    }

    // Priority order: needs the slots (for "how many slots can this band use"),
    // so it's sorted only now.
    const pool = candidates
      .map((c) => ({
        ...c,
        metrics: {
          ...c.metrics,
          eligibleSlots: slots.filter((slot) => canUseSlot(c.availability, slot)).length,
        },
      }))
      .sort((a, b) => comparePriority(rejectionPolicy, a, b));

    const bands: PlannerBand[] = pool.map(({ app, availability, metrics }) => ({
      id: app.id,
      name: app.bandName,
      units: slotEquivalent(app.durationMinutes ?? baseSlotMinutes, baseSlotMinutes),
      availability,
      specKey: normalizeScheduleKey(app.desiredDateTime),
      specLabel: app.desiredDateTime.trim() || "（日程の記載なし）",
      note: describePriorityBasis(rejectionPolicy, app, metrics),
    }));

    return {
      bands,
      slots,
      plan: planRejections(bands, slots),
      bandCount: bands.length,
      usedDays: dayPlans.map(({ p, dayIndex }) => ({
        dayIndex,
        label: p.day.label,
        slotCount: p.deadline?.maxSlots ?? 0,
      })),
      skippedDays: plans.filter((p) => p.deadline === null).map((p) => p.day.label),
      guessedDates,
    };
  }, [plans, applications, plannerIncludePending, rejectionPolicy, baseSlotMinutes]);

  const reasonDetail = useMemo(() => {
    if (!rejectionAnalysis || !reasonBandId) return null;
    const band = rejectionAnalysis.bands.find((b) => b.id === reasonBandId);
    const explanation = explainRejection(
      rejectionAnalysis.bands,
      rejectionAnalysis.slots,
      rejectionAnalysis.plan,
      reasonBandId,
    );
    return band && explanation ? { band, explanation } : null;
  }, [rejectionAnalysis, reasonBandId]);

  function describePlanned(plan: SimulationPlan, planned: PlannedDay): string {
    const parts: string[] = [];
    if (plan.settings) {
      parts.push(
        `設定 ${plan.settings.startTime}開始・演奏${plan.settings.performanceMinutes}分・転換${plan.settings.transitionMinutes}分`,
      );
    }
    if (plan.slotCount !== null) {
      const slotParts: string[] = [];
      if (planned.addedSlots > 0) slotParts.push(`空き枠 +${planned.addedSlots}`);
      if (planned.removedSlots > 0) slotParts.push(`空き枠 −${planned.removedSlots}`);
      if (planned.keptSurplus > 0) slotParts.push(`バンド配置済みの${planned.keptSurplus}枠は削除しません`);
      parts.push(`枠数 ${plan.slotCount}枠（${slotParts.length > 0 ? slotParts.join("、") : "変更なし"}）`);
    }
    if (plan.extras) {
      parts.push(
        `追加項目 ${planned.insertedExtras}行を挿入` +
          (planned.removedCustom > 0 ? `（既存の非演奏枠${planned.removedCustom}行を置き換え）` : ""),
      );
    }
    return parts.length > 0 ? parts.join(" ／ ") : "変更なし";
  }

  function handleApply() {
    if (applyPreview.length === 0 || nothingToApply) return;
    setNextHistoryAction("時間シミュレーションを反映");
    const changed = applySimulationPlans(applyPreview.map((p) => p.plan));
    if (changed === 0) {
      clearNextHistoryAction();
      return;
    }
    showToast(`${changed}日分をタイムテーブルに反映しました（⌘Z / Ctrl+Z で元に戻せます）`, "success");
  }

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-slate-700 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-100">⏱ 時間シミュレーター（全日程）</h2>
            <button
              onClick={onClose}
              className="flex h-11 w-11 items-center justify-center rounded-full text-slate-400 hover:bg-slate-700 hover:text-slate-200 md:h-7 md:w-7"
              title="閉じる"
            >
              ×
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm text-slate-200">
            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-400">枠数の数え方</h3>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["manual", "手入力", "各日の枠数を自分で入力"],
                    ["timetable", "配置から自動", "タイムテーブルの配置済みバンド・休憩枠をそのまま使う"],
                    ["applications", "申込から自動", "申込の演奏時間を使い、日程へ均等に割り振る"],
                  ] as const
                ).map(([value, label, hint]) => (
                  <button
                    key={value}
                    type="button"
                    title={hint}
                    aria-pressed={source === value}
                    onClick={() => setSource(value)}
                    className={`min-h-11 rounded-lg border px-3 text-xs font-semibold md:min-h-0 md:py-1.5 ${
                      source === value
                        ? "border-indigo-400 bg-indigo-950/40 text-indigo-200"
                        : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {source === "applications" && (
                <div className="space-y-1 rounded-lg border border-slate-700 bg-slate-800/60 p-2.5 text-xs text-slate-300">
                  <label className="flex min-h-11 items-center gap-2 md:min-h-0">
                    <input
                      type="checkbox"
                      checked={includePending}
                      onChange={(e) => setIncludePending(e.target.checked)}
                    />
                    未承認の申込も含める
                  </label>
                  <p>
                    対象 {applicationSummary.count}件・演奏時間の合計 {formatDuration(applicationSummary.minutes)}
                    （{applicationSummary.slots}枠換算。20分は2枠）
                  </p>
                  <p className="text-slate-500">
                    演奏時間が未入力のバンドは1枠の長さで計算します。希望日・NG時間は考慮せず、各日の負荷が均等になるよう割り振ります。
                  </p>
                </div>
              )}
              {source === "timetable" && (
                <p className="text-xs text-slate-500">
                  配置済みのバンド（各自の演奏時間・転換時間）と、既に追加済みの休憩・集合などの枠をその順番どおりに使います。未配置の空き枠は数えません。
                </p>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-400">締切時刻の基準</h3>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["lastBand", "最後の演奏の終了"],
                    ["final", "撤収など最後の項目まで含む"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={basis === value}
                    onClick={() => setBasis(value)}
                    className={`min-h-11 rounded-lg border px-3 text-xs font-semibold md:min-h-0 md:py-1.5 ${
                      basis === value
                        ? "border-indigo-400 bg-indigo-950/40 text-indigo-200"
                        : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-400">休憩・準備などの追加項目（手入力）</h3>
              <p className="text-xs text-slate-500">
                追加項目は下の各日のカードで日ごとに設定します。全日程へ同じ項目を入れたいときはここから一括で操作できます。
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setExtrasByDay((prev) =>
                      Object.fromEntries(
                        days.map((d) => [d.id, [...(prev[d.id] ?? []), ...newStandardExtras()]]),
                      ),
                    )
                  }
                  title="幹部集合10分→出演者集合5分→リハーサル10分→諸注意5分／写真撮影5分→完全撤収60分"
                  className="min-h-11 rounded border border-violet-600 bg-violet-950/40 px-2 text-xs text-violet-300 hover:bg-violet-900/50 md:min-h-0 md:py-1"
                >
                  🎬 全日程に定型（開演前後）を追加
                </button>
                <button
                  type="button"
                  onClick={() => setExtrasByDay({})}
                  className="min-h-11 rounded border border-slate-700 px-2 text-xs text-slate-400 hover:bg-slate-700 md:min-h-0 md:py-1"
                >
                  全日程の追加項目をすべて削除
                </button>
              </div>
            </section>

            <section className="rounded-lg border border-indigo-700 bg-indigo-950/30 p-3">
              <h3 className="text-xs font-semibold text-indigo-300">全日程サマリー</h3>
              <dl className="mt-1.5 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">合計バンド数</dt>
                  <dd className="font-semibold">
                    {totals.bandCount}組（{totals.slotCount}枠換算）
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">最も遅い終了（{basisLabel}）</dt>
                  <dd className="font-semibold">
                    {totals.latestEnd !== null ? formatClock(totals.latestEnd) : "-"}
                  </dd>
                </div>
                {totals.deadlineDays > 0 && (
                  <div className="flex justify-between gap-2 sm:col-span-2">
                    <dt className="text-slate-400">
                      締切を設定した{totals.deadlineDays}日の収容枠数 / 必要枠数
                    </dt>
                    <dd
                      className={`font-semibold ${
                        totals.capacity >= totals.demandOnDeadlineDays ? "text-emerald-300" : "text-amber-300"
                      }`}
                    >
                      {totals.capacity}枠 / {totals.demandOnDeadlineDays}枠（
                      {totals.capacity >= totals.demandOnDeadlineDays
                        ? `あと${totals.capacity - totals.demandOnDeadlineDays}枠入る`
                        : `${totals.demandOnDeadlineDays - totals.capacity}枠オーバー`}
                      ）
                    </dd>
                  </div>
                )}
              </dl>
            </section>

            <details className="rounded-lg border border-rose-700 bg-rose-950/20 p-3">
              <summary className="cursor-pointer select-none text-xs font-semibold text-rose-300">
                🔎 日時指定を考慮した収容チェック（却下の目安）
              </summary>
              <div className="mt-3 space-y-3 text-xs text-slate-300">
                <p className="text-slate-400">
                  各日の締切までに実際に使える枠（時刻つき）と、申請の出演希望日・時間を照らし合わせ、日時指定を満たして入る最大組数と、入らない申請を日時指定ごとに出します。締切時刻を入れた日だけが対象です。
                </p>
                <label className="flex min-h-11 items-center gap-2 md:min-h-0">
                  <input
                    type="checkbox"
                    checked={plannerIncludePending}
                    onChange={(e) => setPlannerIncludePending(e.target.checked)}
                  />
                  未承認の申込も対象にする（外すと承認済みのみ）
                </label>

                <fieldset className="space-y-1">
                  <legend className="mb-1 font-semibold text-slate-400">誰を残すか（却下する順番の基準）</legend>
                  {REJECTION_POLICIES.map((policy) => (
                    <label
                      key={policy.value}
                      className={`flex min-h-11 cursor-pointer items-start gap-2 rounded border p-2 md:min-h-0 ${
                        rejectionPolicy === policy.value
                          ? "border-rose-500 bg-rose-950/40"
                          : "border-slate-700 hover:bg-slate-800/50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="rejection-policy"
                        className="mt-0.5"
                        checked={rejectionPolicy === policy.value}
                        onChange={() => setRejectionPolicy(policy.value)}
                      />
                      <span>
                        <span className="font-semibold text-slate-100">{policy.label}</span>
                        <span className="block text-slate-400">{policy.description}</span>
                      </span>
                    </label>
                  ))}
                  <p className="text-slate-500">どの基準でも、同順位の場合は申請が早い方を残します。</p>
                </fieldset>

                {rejectionAnalysis === null ? (
                  <p className="rounded border border-slate-700 bg-slate-900/50 p-2 text-slate-400">
                    下の各日のカードで「締切時刻」を入力すると計算します。
                  </p>
                ) : (
                  <>
                    <div className="space-y-1 rounded border border-slate-700 bg-slate-900/50 p-2">
                      <p>
                        対象の日：
                        {rejectionAnalysis.usedDays
                          .map((d) => `${d.label}（${d.slotCount}枠）`)
                          .join("、")}
                        {rejectionAnalysis.skippedDays.length > 0 &&
                          ` ／ 締切なしのため対象外：${rejectionAnalysis.skippedDays.join("、")}`}
                      </p>
                      <p>
                        申請 {rejectionAnalysis.bandCount}組（{rejectionAnalysis.plan.totalUnits}枠換算）に対して、
                        収容 {rejectionAnalysis.plan.capacity}枠 → 日時指定を満たして入るのは{" "}
                        <span className="font-semibold text-slate-100">
                          {rejectionAnalysis.plan.seatedBandIds.size}組
                        </span>
                      </p>
                      <p
                        className={`text-sm font-semibold ${
                          rejectionAnalysis.plan.rejected.length === 0 ? "text-emerald-300" : "text-rose-300"
                        }`}
                      >
                        {rejectionAnalysis.plan.rejected.length === 0
                          ? "✅ 全員が日時指定どおりに入ります（却下は不要）"
                          : `⚠ 最低 ${rejectionAnalysis.plan.rejected.length}組 が入りません（却下の目安）`}
                      </p>
                      {rejectionAnalysis.guessedDates && (
                        <p className="text-amber-300">
                          日付が未設定の日は、申請に書かれた日付を小さい順に対応させて計算しています（日の設定で日付を入れると正確になります）。
                        </p>
                      )}
                    </div>

                    {rejectionAnalysis.plan.rejected.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="font-semibold text-slate-400">どの日時指定のバンドを何組却下するか</p>
                        <ul className="space-y-1.5">
                          {rejectionAnalysis.plan.groups
                            .filter((g) => g.rejected > 0)
                            .map((g) => (
                              <li key={g.key} className="rounded border border-rose-800 bg-rose-950/30 p-2">
                                <p>
                                  <span className="font-semibold text-rose-300">{g.rejected}組を却下</span>
                                  <span className="ml-2 text-slate-400">
                                    （同じ日時指定の申請 {g.total}組のうち、入るのは {g.seated}組）
                                  </span>
                                </p>
                                <p className="mt-0.5 break-words text-slate-100">日時指定：{g.label}</p>
                                                <div className="mt-1 flex flex-wrap items-center gap-1">
                                  <span className="text-slate-400">対象：</span>
                                  {rejectionAnalysis.plan.rejected
                                    .filter((b) => b.specKey === g.key)
                                    .map((b) => (
                                      <button
                                        key={b.id}
                                        type="button"
                                        onClick={() => setReasonBandId(b.id)}
                                        title="なぜこのバンドが入らないのか、理由を表示"
                                        className="min-h-11 rounded border border-rose-700 bg-rose-950/50 px-2 text-slate-100 hover:bg-rose-900/60 md:min-h-0 md:py-0.5"
                                      >
                                        {b.name}
                                        <span className="ml-1 text-rose-300">ⓘ 理由</span>
                                      </button>
                                    ))}
                                </div>
                              </li>
                            ))}
                        </ul>
                      </div>
                    )}

                    <details className="text-slate-400">
                      <summary className="cursor-pointer select-none py-1 hover:text-slate-200">
                        日時指定ごとの内訳（すべて）
                      </summary>
                      <ul className="mt-1 space-y-0.5">
                        {rejectionAnalysis.plan.groups.map((g) => (
                          <li key={g.key} className="flex flex-wrap gap-x-2">
                            <span className="min-w-0 break-words">{g.label}</span>
                            <span className="text-slate-500">
                              {g.total}組 → 入る{g.seated}組
                              {g.rejected > 0 && <span className="text-rose-300">／却下{g.rejected}組</span>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>

                    <p className="text-slate-500">
                      選んだ基準の順に席を確保し、入らなかった分を「却下の目安」にしています（入る組数は日時指定を満たす上での最大値で、基準を変えても基本的に変わらず、変わるのは誰が残るかです）。2枠分（20分）のバンドは枠の連続までは見ず、各枠の時間帯だけで判定します。
                    </p>
                  </>
                )}
              </div>
            </details>

            <details className="rounded-lg border border-emerald-700 bg-emerald-950/20 p-3">
              <summary className="cursor-pointer select-none text-xs font-semibold text-emerald-300">
                📥 シミュレーション結果をタイムテーブルに反映
              </summary>
              <div className="mt-3 space-y-3 text-xs text-slate-300">
                <div className="space-y-1">
                  <p className="font-semibold text-slate-400">反映する日</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {days.map((day) => (
                      <label key={day.id} className="flex min-h-11 items-center gap-1.5 md:min-h-0">
                        <input
                          type="checkbox"
                          checked={!excludedApplyDays.has(day.id)}
                          onChange={(e) =>
                            setExcludedApplyDays((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.delete(day.id);
                              else next.add(day.id);
                              return [...next];
                            })
                          }
                        />
                        {day.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="font-semibold text-slate-400">反映する内容</p>
                  <label className="flex min-h-11 items-center gap-2 md:min-h-0">
                    <input
                      type="checkbox"
                      checked={applySettings}
                      onChange={(e) => setApplySettings(e.target.checked)}
                    />
                    開始時刻・1枠の演奏・転換時間（その日の設定）
                  </label>
                  <fieldset className="space-y-1">
                    <legend className="mb-0.5">枠数（演奏枠の数）</legend>
                    {(
                      [
                        ["sim", "シミュレーション上の枠数に合わせる（空き枠を増減）", false],
                        ["max", "締切までに入る最大枠数に合わせる（締切のない日は上と同じ）", !anyDeadline],
                        ["none", "変更しない", false],
                      ] as const
                    ).map(([value, label, disabled]) => (
                      <label
                        key={value}
                        className={`flex min-h-11 items-center gap-2 md:min-h-0 ${disabled ? "opacity-40" : ""}`}
                      >
                        <input
                          type="radio"
                          name="simulator-slot-mode"
                          checked={slotMode === value}
                          disabled={disabled}
                          onChange={() => setSlotMode(value)}
                        />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                  <label className="flex min-h-11 items-center gap-2 md:min-h-0">
                    <input
                      type="checkbox"
                      checked={applyExtras}
                      onChange={(e) => setApplyExtras(e.target.checked)}
                    />
                    追加項目（休憩・準備・撤収など）を、シミュレーションと同じ位置に挿入
                  </label>
                  <label
                    className={`ml-5 flex min-h-11 items-center gap-2 md:min-h-0 ${applyExtras ? "" : "opacity-40"}`}
                  >
                    <input
                      type="checkbox"
                      checked={replaceCustom}
                      disabled={!applyExtras}
                      onChange={(e) => setReplaceOverride(e.target.checked)}
                    />
                    既存の休憩・集合などの枠を置き換える
                    {source === "timetable" && (
                      <span className="text-slate-500">（配置から自動のときは既存の枠も計算に含まれるため、標準ではオフ）</span>
                    )}
                  </label>
                </div>

                <div className="space-y-1">
                  <p className="font-semibold text-slate-400">反映される内容</p>
                  {applyPreview.length === 0 ? (
                    <p className="text-slate-500">反映する日が選ばれていません。</p>
                  ) : (
                    <ul className="space-y-0.5">
                      {applyPreview.map(({ plan, label, planned }) => (
                        <li key={plan.dayId}>
                          <span className="font-semibold text-slate-200">{label}</span>：
                          {describePlanned(plan, planned)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <p className="text-slate-500">
                  配置済みのバンドは動かしません。空き枠には転換時間が付かないため、バンドを配置するとタイムテーブルの時刻がシミュレーションどおりになります。反映は1回の操作として履歴に残り、元に戻せます。
                </p>
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={applyPreview.length === 0 || nothingToApply}
                  className="min-h-11 rounded bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 md:min-h-0 md:py-1.5"
                >
                  タイムテーブルに反映する
                </button>
              </div>
            </details>

            <div className="grid gap-3 md:grid-cols-2">
              {plans.map(({ day, input, extras, result, slotCount, deadline }) => (
                <section key={day.id} className="space-y-2 rounded-lg border border-slate-700 bg-slate-800/60 p-3">
                  <h3 className="text-sm font-semibold text-slate-100">
                    {day.label}
                    {day.date && <span className="ml-2 text-xs font-normal text-slate-500">{day.date}</span>}
                  </h3>

                  <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-400">
                    <label className="flex flex-col gap-0.5">
                      開始時刻
                      <input
                        type="time"
                        value={input.startTime}
                        onChange={(e) => patchDay(day.id, { startTime: e.target.value })}
                        className={inputClass}
                      />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      1枠の演奏（分）
                      <input
                        type="number"
                        min={1}
                        value={input.performanceMinutes}
                        onChange={(e) => patchDay(day.id, { performanceMinutes: Math.max(1, toNumber(e.target.value)) })}
                        className={inputClass}
                      />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      転換（分）
                      <input
                        type="number"
                        min={0}
                        value={input.transitionMinutes}
                        onChange={(e) => patchDay(day.id, { transitionMinutes: toNumber(e.target.value) })}
                        className={inputClass}
                      />
                    </label>
                    <label className="flex flex-col gap-0.5">
                      {source === "manual" ? "枠数（組）" : "枠数（自動）"}
                      {source === "manual" ? (
                        <input
                          type="number"
                          min={0}
                          value={input.manualCount}
                          onChange={(e) => patchDay(day.id, { manualCount: toNumber(e.target.value) })}
                          className={inputClass}
                        />
                      ) : (
                        <span className="flex min-h-11 items-center rounded border border-slate-700 bg-slate-900 px-2 text-sm text-slate-200 md:min-h-0 md:py-1.5">
                          {result.bandCount}組
                        </span>
                      )}
                    </label>
                    <label className="col-span-2 flex flex-col gap-0.5">
                      締切時刻（任意）
                      <input
                        type="time"
                        value={input.deadline}
                        onChange={(e) => patchDay(day.id, { deadline: e.target.value })}
                        className={inputClass}
                      />
                    </label>
                  </div>
                  <ExtrasEditor
                    dayLabel={day.label}
                    extras={extras}
                    canCopyToOtherDays={days.length > 1}
                    onAdd={() =>
                      updateExtras(day.id, (prev) => [
                        ...prev,
                        { id: crypto.randomUUID(), label: "休憩", minutes: 10, position: "middle", afterBandCount: 5 },
                      ])
                    }
                    onAddStandard={() => updateExtras(day.id, (prev) => [...prev, ...newStandardExtras()])}
                    onClear={() => updateExtras(day.id, () => [])}
                    onPatch={(id, patch) =>
                      updateExtras(day.id, (prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
                    }
                    onRemove={(id) => updateExtras(day.id, (prev) => prev.filter((e) => e.id !== id))}
                    onCopyToOtherDays={() => copyExtrasToOtherDays(day.id)}
                  />

                  <dl className="space-y-1 rounded border border-slate-700 bg-slate-900/60 p-2 text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-400">最後の演奏の終了</dt>
                      <dd className="font-semibold text-slate-100">
                        {result.lastBandEnd !== null ? formatClock(result.lastBandEnd) : "-"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-400">全体の終了（撤収など含む）</dt>
                      <dd className="font-semibold text-slate-100">
                        {formatClock(result.finalEnd)}
                        <span className="ml-1 inline-block whitespace-nowrap font-normal text-slate-500">
                          （所要{formatDuration(result.finalEnd - result.startMinutes)}）
                        </span>
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-400">バンド数</dt>
                      <dd className="font-semibold text-slate-100">
                        {result.bandCount}組（{slotCount}枠換算）
                      </dd>
                    </div>
                    {deadline && (
                      <>
                        <div className="flex justify-between gap-2 border-t border-slate-700 pt-1">
                          <dt className="text-slate-400">締切 {formatClock(deadline.absolute)} に対して</dt>
                          <dd
                            className={`font-semibold ${deadline.margin >= 0 ? "text-emerald-300" : "text-amber-300"}`}
                          >
                            {deadline.margin >= 0
                              ? `✅ 間に合う（余裕${formatDuration(deadline.margin)}）`
                              : `⚠ ${formatDuration(-deadline.margin)}超過`}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-400">締切までに入る最大枠数</dt>
                          <dd className="font-semibold text-slate-100">
                            {deadline.maxSlots}枠
                            <span
                              className={`ml-1 font-normal ${
                                deadline.maxSlots >= slotCount ? "text-emerald-300" : "text-amber-300"
                              }`}
                            >
                              （{deadline.maxSlots >= slotCount
                                ? `あと${deadline.maxSlots - slotCount}枠`
                                : `${slotCount - deadline.maxSlots}枠オーバー`}
                              ）
                            </span>
                          </dd>
                        </div>
                      </>
                    )}
                  </dl>

                  <details className="text-xs text-slate-300">
                    <summary className="cursor-pointer select-none py-1 text-slate-400 hover:text-slate-200">
                      タイムライン（{result.rows.length}行）
                    </summary>
                    <ul className="mt-1 max-h-60 space-y-0.5 overflow-y-auto pr-1">
                      {result.rows.map((row) => (
                        <li
                          key={row.key}
                          className={`flex gap-2 rounded px-1.5 py-0.5 ${
                            row.kind === "extra" ? "bg-amber-950/30 text-amber-200" : ""
                          }`}
                        >
                          <span className="w-28 shrink-0 font-mono text-slate-400">
                            {formatClock(row.start)}–{formatClock(row.end)}
                          </span>
                          <span className="min-w-0 break-words">{row.label}</span>
                        </li>
                      ))}
                      {result.rows.length === 0 && <li className="text-slate-500">項目がありません</li>}
                    </ul>
                  </details>
                </section>
              ))}
            </div>
          </div>
        </div>
      </div>
      {reasonDetail && (
        <RejectionReasonDialog
          band={reasonDetail.band}
          explanation={reasonDetail.explanation}
          dayLabels={days.map((d) => d.label)}
          policyLabel={REJECTION_POLICIES.find((p) => p.value === rejectionPolicy)?.label ?? ""}
          onClose={() => setReasonBandId(null)}
        />
      )}
    </ModalPortal>
  );
}
