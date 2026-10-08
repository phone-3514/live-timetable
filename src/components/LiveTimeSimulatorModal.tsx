import { useMemo, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useApplicationStore } from "../store/useApplicationStore";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { ModalPortal } from "./ModalPortal";
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
  type DeadlineBasis,
  type SimExtra,
  type SimItem,
} from "../utils/liveTimeSimulation";

type Source = "manual" | "timetable" | "applications";

type DayInput = {
  startTime: string;
  performanceMinutes: number;
  transitionMinutes: number;
  manualCount: number;
  /** "" = no deadline set for this day. */
  deadline: string;
  useExtras: boolean;
};

function defaultsFor(day: TimetableDay): DayInput {
  const placed = day.slots.filter((s) => s.bandId).length;
  return {
    startTime: day.settings.startTime,
    performanceMinutes: day.settings.performanceMinutes,
    transitionMinutes: day.settings.transitionMinutes,
    manualCount: placed > 0 ? placed : 10,
    deadline: "",
    useExtras: true,
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

// 全日程まとめてシミュレーション: for every day at once, "this start time +
// this many bands (typed, taken from the timetable as placed, or counted from
// the applications) + these extras ends at …", and the reverse — "to finish
// by this time, this many bands fit". All the arithmetic lives in
// liveTimeSimulation.ts, which runs on the real timetable's own time
// calculation so what's shown here matches what the timetable would show.
export function LiveTimeSimulatorModal({ onClose }: { onClose: () => void }) {
  useEscapeKey(onClose);
  const days = useAppStore((s) => s.days);
  const bands = useAppStore((s) => s.bands);
  const applications = useApplicationStore((s) => s.applications);

  const [source, setSource] = useState<Source>("manual");
  const [includePending, setIncludePending] = useState(false);
  const [basis, setBasis] = useState<DeadlineBasis>("lastBand");
  const [extras, setExtras] = useState<SimExtra[]>([]);
  const [dayInputs, setDayInputs] = useState<Record<string, DayInput>>(() =>
    Object.fromEntries(days.map((d) => [d.id, defaultsFor(d)])),
  );

  const inputFor = (day: TimetableDay): DayInput => dayInputs[day.id] ?? defaultsFor(day);
  const patchDay = (dayId: string, patch: Partial<DayInput>) =>
    setDayInputs((prev) => {
      const day = days.find((d) => d.id === dayId);
      const current = prev[dayId] ?? (day ? defaultsFor(day) : undefined);
      return current ? { ...prev, [dayId]: { ...current, ...patch } } : prev;
    });

  const patchExtra = (id: string, patch: Partial<SimExtra>) =>
    setExtras((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));

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
    const extrasMinutes = extras.reduce((sum, e) => sum + e.minutes, 0);

    // 申込から自動: spread the bands over the days by load, seeding each day
    // with the extras it will carry (when it uses them).
    let assignment: number[] = [];
    if (source === "applications") {
      assignment = distributeAcrossDays(
        sourceApplications.map((a) => a.durationMinutes ?? fallbackMinutes),
        days.map((d) => (inputFor(d).useExtras ? extrasMinutes : 0)),
        fallbackTransition,
      );
    }

    return days.map((day, dayIndex) => {
      const input = inputFor(day);
      const settings = {
        startTime: input.startTime || day.settings.startTime,
        performanceMinutes: input.performanceMinutes,
        transitionMinutes: input.transitionMinutes,
      };
      const effectiveExtras = input.useExtras ? extras : [];

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
      return { day, input, result, slotCount, deadline };
    });
  }, [days, dayInputs, extras, source, sourceApplications, bandMap, basis]);

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
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xs font-semibold text-slate-400">休憩・準備などの追加項目（手入力）</h3>
                <button
                  type="button"
                  onClick={() =>
                    setExtras((prev) => [
                      ...prev,
                      { id: crypto.randomUUID(), label: "休憩", minutes: 10, position: "middle", afterBandCount: 5 },
                    ])
                  }
                  className="min-h-11 rounded border border-slate-600 px-2 text-xs text-slate-200 hover:bg-slate-700 md:min-h-0 md:py-1"
                >
                  + 項目を追加
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setExtras((prev) => [
                      ...prev,
                      ...STANDARD_SIM_EXTRAS.map((e) => ({ ...e, id: crypto.randomUUID() })),
                    ])
                  }
                  title="幹部集合10分→出演者集合5分→リハーサル10分→諸注意5分／写真撮影5分→完全撤収60分"
                  className="min-h-11 rounded border border-violet-600 bg-violet-950/40 px-2 text-xs text-violet-300 hover:bg-violet-900/50 md:min-h-0 md:py-1"
                >
                  🎬 定型（開演前後）を追加
                </button>
                {extras.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setExtras([])}
                    className="min-h-11 rounded border border-slate-700 px-2 text-xs text-slate-400 hover:bg-slate-700 md:min-h-0 md:py-1"
                  >
                    すべて削除
                  </button>
                )}
              </div>
              {extras.length === 0 ? (
                <p className="text-xs text-slate-500">
                  追加項目はありません。「定型」ボタンで開演前後のいつもの流れを一括追加できます。
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {extras.map((extra) => (
                    <li key={extra.id} className="flex flex-wrap items-center gap-1.5">
                      <input
                        value={extra.label}
                        onChange={(e) => patchExtra(extra.id, { label: e.target.value })}
                        aria-label="項目名"
                        className={`${fieldClass} min-w-0 flex-1 basis-32`}
                      />
                      <input
                        type="number"
                        min={0}
                        value={extra.minutes}
                        onChange={(e) => patchExtra(extra.id, { minutes: toNumber(e.target.value) })}
                        aria-label={`${extra.label}の所要時間（分）`}
                        className={`${fieldClass} w-16`}
                      />
                      <span className="text-xs text-slate-500">分</span>
                      <select
                        value={extra.position}
                        onChange={(e) =>
                          patchExtra(extra.id, { position: e.target.value as SimExtra["position"] })
                        }
                        aria-label={`${extra.label}の位置`}
                        className={`${fieldClass} w-28`}
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
                              patchExtra(extra.id, { afterBandCount: Math.max(1, toNumber(e.target.value)) })
                            }
                            aria-label={`${extra.label}を入れるバンド数`}
                            className={`${fieldClass} w-16`}
                          />
                          <span className="text-xs text-slate-500">組目の後</span>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => setExtras((prev) => prev.filter((e) => e.id !== extra.id))}
                        className="flex h-11 w-11 items-center justify-center rounded text-slate-500 hover:text-rose-400 md:h-8 md:w-8"
                        title="削除"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
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

            <div className="grid gap-3 md:grid-cols-2">
              {plans.map(({ day, input, result, slotCount, deadline }) => (
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
                  <label className="flex min-h-11 items-center gap-2 text-xs text-slate-300 md:min-h-0">
                    <input
                      type="checkbox"
                      checked={input.useExtras}
                      onChange={(e) => patchDay(day.id, { useExtras: e.target.checked })}
                    />
                    追加項目（休憩・準備など）を含める
                  </label>

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
    </ModalPortal>
  );
}
