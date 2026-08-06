import { useState } from "react";
import { useAutoScheduleDebugStore } from "../store/useAutoScheduleDebugStore";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { ModalPortal } from "./ModalPortal";

interface Props {
  onClose: () => void;
}

function fmt(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return rounded > 0 ? `+${rounded.toFixed(2)}` : rounded.toFixed(2);
}

function ScoreRow({ label, value }: { label: string; value: number }) {
  const tone = value > 0 ? "text-emerald-400" : value < 0 ? "text-rose-400" : "text-slate-500";
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-slate-400">{label}</span>
      <span className={`font-mono ${tone}`}>{fmt(value)}</span>
    </div>
  );
}

// 管理者専用「スコア詳細」— 直近の一括自動配置がなぜその配置になったかを、
// 出演枠ごとのスコア内訳と出演者ごとのブロック分散状況で確認できるように
// する。useAutoScheduleDebugStore(persistしないメモリ内だけのstore)を
// そのまま表示するだけで、ライブ構成評価やスコア内訳をどこにも保存しない。
// 一般ユーザー画面・出演者画面・公開タイムテーブル・パンフレット・会場
// スクリーン・PA画面のいずれからも参照されない — ここ(組織者専用の
// タイムテーブル編集画面)からしか開けない。
export function AutoScheduleDebugModal({ onClose }: Props) {
  useEscapeKey(onClose);
  const entries = useAutoScheduleDebugStore((s) => s.entries);
  const [activeDayId, setActiveDayId] = useState(entries[0]?.dayId ?? null);
  const active = entries.find((e) => e.dayId === activeDayId) ?? entries[0] ?? null;

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        onClick={onClose}
      >
        <div
          className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">🔍 スコア詳細（管理者専用）</h2>
              <p className="mt-1 text-xs text-slate-400">
                直近の一括自動配置で、各出演枠がなぜその位置へ配置されたかを確認できます。ライブ構成評価やこの内訳は保存されず、この画面を閉じる・再配置するまでのみ有効です。
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg leading-none text-slate-500 hover:bg-slate-700 hover:text-slate-300"
              title="閉じる"
            >
              ×
            </button>
          </div>

          {entries.length === 0 ? (
            <p className="mt-6 rounded-md border border-slate-700 px-3 py-8 text-center text-xs text-slate-500">
              まだ自動配置が実行されていません。「⚡ 一括自動配置」を実行すると、ここにスコア詳細が表示されます。
            </p>
          ) : (
            <>
              {entries.length > 1 && (
                <div className="mt-3 flex shrink-0 flex-wrap gap-1.5">
                  {entries.map((e) => (
                    <button
                      key={e.dayId}
                      type="button"
                      onClick={() => setActiveDayId(e.dayId)}
                      className={`min-h-9 rounded px-2.5 text-xs font-medium ${
                        active?.dayId === e.dayId
                          ? "bg-indigo-600 text-white"
                          : "border border-slate-600 text-slate-300 hover:bg-slate-700"
                      }`}
                    >
                      {e.dayLabel}
                    </button>
                  ))}
                </div>
              )}

              {active && (
                <div className="mt-4 min-h-0 flex-1 space-y-5 overflow-y-auto">
                  <section>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-slate-700 bg-slate-800/50 p-2.5 text-xs">
                      <span className={active.result.hardConstraintsValid ? "text-emerald-400" : "text-rose-400"}>
                        {active.result.hardConstraintsValid ? "✓ ハード制約: 満たしています" : "✗ ハード制約: 違反があります"}
                      </span>
                      <span className="text-slate-300">
                        合計スコア: <span className="font-mono">{fmt(active.result.totalScore)}</span>
                      </span>
                    </div>

                    {active.result.violations.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {active.result.violations.map((v, i) => (
                          <li key={i} className="rounded border border-rose-700 bg-rose-950/20 px-2 py-1 text-[11px] text-rose-300">
                            ⚠ {v}
                          </li>
                        ))}
                      </ul>
                    )}
                    {active.result.failures.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {active.result.failures.map((f, i) => (
                          <li key={i} className="rounded border border-rose-700 bg-rose-950/20 px-2 py-1 text-[11px] text-rose-300">
                            ⚠ {f.message}
                          </li>
                        ))}
                      </ul>
                    )}
                    {active.result.warnings.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {active.result.warnings.map((w, i) => (
                          <li key={i} className="rounded border border-amber-700 bg-amber-950/20 px-2 py-1 text-[11px] text-amber-300">
                            💡 {w}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section>
                    <h3 className="text-xs font-semibold text-slate-300">👥 出演者ごとのブロック分散</h3>
                    {active.result.performers.length === 0 ? (
                      <p className="mt-2 text-[11px] text-slate-500">この日に出演するメンバー情報はありません</p>
                    ) : (
                      <ul className="mt-2 space-y-1.5">
                        {active.result.performers.map((p) => (
                          <li
                            key={p.personId}
                            className={`rounded border p-2 text-[11px] ${
                              p.isLowRatedBandGroup
                                ? "border-amber-700 bg-amber-950/10"
                                : "border-slate-700 bg-slate-800/40"
                            }`}
                          >
                            <span className="font-semibold text-slate-200">{p.displayName}</span>
                            <span className="ml-1.5 text-slate-500">
                              {p.totalAppearances}バンド出演 / 評価
                              {p.bandRatings.join("・")}
                            </span>
                            {p.isLowRatedBandGroup && (
                              <span className="ml-1.5 rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                                低評価バンド群
                              </span>
                            )}
                            {p.appearsInFinalBlock && (
                              <span className="ml-1.5 rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
                                最終ブロックに出演あり
                              </span>
                            )}
                            <div className="mt-1 flex flex-wrap gap-1">
                              {Object.entries(p.appearancesByBlock).map(([blockId, count]) => (
                                <span key={blockId} className="rounded bg-slate-700/50 px-1.5 py-0.5 text-[10px] text-slate-400">
                                  {blockId}: {count}枠（上限{p.maxAllowedPerBlock}）
                                </span>
                              ))}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section>
                    <h3 className="text-xs font-semibold text-slate-300">🎵 出演枠ごとのスコア内訳</h3>
                    <ul className="mt-2 space-y-2">
                      {active.result.slots.map((s) => (
                        <li key={s.slotId} className="rounded-md border border-slate-700 bg-slate-800/40 p-2.5">
                          <p className="text-xs font-semibold text-slate-200">
                            {s.startTime} {s.bandName}
                            <span className="ml-1.5 font-normal text-slate-500">評価{s.rating}</span>
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-400">
                            第{s.blockIndex + 1}ブロック ・ 全体位置 {s.globalPosition.toFixed(2)} ・ ブロック内位置{" "}
                            {s.blockPosition.toFixed(2)} ・ 終盤判定 {s.isFinalPhase ? "対象" : "対象外"}（進行度{" "}
                            {s.finalPhaseProgress.toFixed(2)}）
                          </p>
                          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 border-t border-slate-700 pt-2 sm:grid-cols-3">
                            <ScoreRow label="全体時間軸" value={s.scoreContributions.globalTimeline} />
                            <ScoreRow label="終盤補正" value={s.scoreContributions.finalPhase} />
                            <ScoreRow label="評価5終盤補正" value={s.scoreContributions.ratingFiveFinalPhase} />
                            <ScoreRow label="ブロック内位置" value={s.scoreContributions.blockTimeline} />
                            <ScoreRow label="滑らかさ" value={s.scoreContributions.smoothness} />
                            <ScoreRow label="ブロック終端" value={s.scoreContributions.blockClosing} />
                            <ScoreRow label="低評価出演者補正" value={s.scoreContributions.lowRatedPerformerDistribution} />
                          </div>
                          <div className="mt-1.5 flex justify-end border-t border-slate-700 pt-1.5 text-[11px]">
                            <span className="text-slate-300">
                              合計: <span className="font-mono">{fmt(s.scoreContributions.total)}</span>
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              )}
            </>
          )}

          <div className="mt-5 flex shrink-0 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded border border-slate-600 px-4 text-sm font-medium text-slate-300 hover:bg-slate-700 sm:min-h-0 sm:py-1.5 sm:text-xs"
            >
              閉じる
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
