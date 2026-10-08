import { ModalPortal } from "./ModalPortal";
import { formatClock } from "../utils/liveTimeSimulation";
import type { PlannerBand, PlannerSlot, RejectionExplanation } from "../utils/rejectionPlanner";

type DaySummary = { key: string; label: string; count: number; start: number; end: number };

// "17日 10:00〜15:30（12枠）" per day: the slots are one contiguous run in
// practice, so the earliest start / latest end describes them.
function summarizeSlots(slots: PlannerSlot[], dayLabels: string[]): DaySummary[] {
  const byDay = new Map<number, PlannerSlot[]>();
  for (const slot of slots) byDay.set(slot.dayIndex, [...(byDay.get(slot.dayIndex) ?? []), slot]);
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([dayIndex, list]) => ({
      key: String(dayIndex),
      label: dayLabels[dayIndex] ?? `${dayIndex + 1}日目`,
      count: list.length,
      start: Math.min(...list.map((s) => s.start)),
      end: Math.max(...list.map((s) => s.end)),
    }));
}

function SlotSummary({ slots, dayLabels }: { slots: PlannerSlot[]; dayLabels: string[] }) {
  const days = summarizeSlots(slots, dayLabels);
  if (days.length === 0) return <span className="text-rose-300">なし</span>;
  return (
    <span>
      {days
        .map((d) => `${d.label} ${formatClock(d.start)}〜${formatClock(d.end)}（${d.count}枠）`)
        .join("、")}
    </span>
  );
}

// The "why this band" popup. Everything shown is derived from the explanation
// the planner returns, so it describes exactly what the check computed.
export function RejectionReasonDialog({
  band,
  explanation,
  dayLabels,
  policyLabel,
  onClose,
}: {
  band: PlannerBand;
  explanation: RejectionExplanation;
  dayLabels: string[];
  policyLabel: string;
  onClose: () => void;
}) {
  const noEligible = explanation.eligibleSlots.length === 0;
  // Lowest-priority first: if one of these has to give way, the one the chosen
  // order values least is the natural pick.
  const lowestFirst = [...explanation.blockers].sort((a, b) => b.rank - a.rank);
  const chained = lowestFirst.filter((b) => !b.direct);
  const direct = lowestFirst.filter((b) => b.direct);
  const SHOWN = 5;

  const renderBlocker = ({ band: other, rank }: RejectionExplanation["blockers"][number]) => (
    <li key={other.id} className="rounded border border-slate-700 bg-slate-950/40 p-1.5">
      <p className="break-words text-slate-100">
        <span className="mr-1.5 text-slate-500">{rank}番目</span>
        {other.name}
      </p>
      <p className="break-words text-slate-400">日時指定：{other.specLabel}</p>
      {other.note && <p className="break-words text-slate-500">{other.note}</p>}
    </li>
  );
  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-label={`${band.name} が入らない理由`}
          className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-rose-700 bg-slate-900 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2 border-b border-slate-700 px-4 py-3">
            <div className="min-w-0">
              <p className="text-[11px] text-rose-300">却下の目安：理由</p>
              <h3 className="break-words text-sm font-semibold text-slate-100">{band.name}</h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-slate-100 md:h-8 md:w-8"
              aria-label="閉じる"
            >
              ✕
            </button>
          </div>

          <div className="space-y-3 overflow-y-auto px-4 py-3 text-xs text-slate-300">
            <section className="space-y-1 rounded border border-slate-700 bg-slate-950/40 p-2">
              <p>
                <span className="text-slate-500">日時指定：</span>
                <span className="break-words text-slate-100">{band.specLabel}</span>
              </p>
              <p>
                <span className="text-slate-500">優先順位：</span>
                <span className="text-slate-100">
                  {explanation.rank}番目 / {explanation.total}組
                </span>
                <span className="ml-1 text-slate-500">（{policyLabel}）</span>
              </p>
              {band.note && (
                <p>
                  <span className="text-slate-500">順位の根拠：</span>
                  <span className="break-words text-slate-100">{band.note}</span>
                </p>
              )}
              <p>
                <span className="text-slate-500">必要な枠：</span>
                <span className="text-slate-100">{band.units}枠</span>
              </p>
            </section>

            <section className="space-y-1">
              <h4 className="font-semibold text-slate-400">結論</h4>
              {noEligible ? (
                <p className="text-rose-300">
                  日時指定に合う枠が1つもありません。書かれている日付がタイムテーブルの日に無いか、希望の時間帯が各日の締切までの枠と重なっていません。日時指定を修正するか、枠の設定（開始時刻・締切）を見直すと入る可能性があります。
                </p>
              ) : explanation.freeSlotReachable ? (
                <p className="text-rose-300">
                  使える枠に空きはありますが、このバンドは{band.units}枠分が必要で、必要な枠数をまとめて確保できませんでした（枠の連続までは見ていないため目安です）。
                </p>
              ) : (
                <p className="text-rose-300">
                  使える枠はすべて、優先順位が上のバンドで埋まっています。ほかの枠へ組み替えられるバンドも動かしましたが、空きは出ませんでした。
                </p>
              )}
            </section>

            <section className="space-y-1">
              <h4 className="font-semibold text-slate-400">このバンドが使える枠</h4>
              <p>
                日時指定に合う枠：
                <SlotSummary slots={explanation.eligibleSlots} dayLabels={dayLabels} />
              </p>
              {explanation.reachableSlots.length > explanation.eligibleSlots.length && (
                <p>
                  他のバンドの組み替えまで含めた範囲：
                  <SlotSummary slots={explanation.reachableSlots} dayLabels={dayLabels} />
                </p>
              )}
            </section>

            {explanation.blockers.length > 0 && (
              <section className="space-y-1.5">
                <h4 className="font-semibold text-slate-400">
                  その枠を使っているバンド（{explanation.blockers.length}組）
                </h4>
                <p className="text-slate-500">
                  順位が上のバンドです。このうちどれか1組を却下すれば、このバンドが入れます（順位が低い順に並べています。入れ替えるなら上のものが妥当です）。
                </p>
                {[
                  { title: "この日時指定の枠をそのまま使っている", list: direct },
                  { title: "組み替え可能だが、移れる先も埋まっている", list: chained },
                ]
                  .filter((g) => g.list.length > 0)
                  .map((g) => (
                    <div key={g.title}>
                      <p className="mb-0.5 text-[11px] text-slate-500">{g.title}</p>
                      <ul className="space-y-1">{g.list.slice(0, SHOWN).map(renderBlocker)}</ul>
                      {g.list.length > SHOWN && (
                        <details className="mt-1">
                          <summary className="cursor-pointer select-none py-1 text-slate-400 hover:text-slate-200">
                            ほか {g.list.length - SHOWN}組を表示
                          </summary>
                          <ul className="mt-1 space-y-1">{g.list.slice(SHOWN).map(renderBlocker)}</ul>
                        </details>
                      )}
                    </div>
                  ))}
              </section>
            )}
          </div>

          <div className="border-t border-slate-700 px-4 py-2 text-right">
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
