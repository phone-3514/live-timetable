import { useAppStore } from "../store/useAppStore";
import { useCollabStore } from "../store/useCollabStore";
import { setNextHistoryAction } from "../store/useHistoryStore";
import type { Changeover } from "../utils/changeoverInfo";

interface Props {
  dayId: string;
  info: Changeover;
}

// 出演枠と出演枠の間に「転換 N分」を常に表示する細い行。規定より短ければ赤にして
// 気づけるようにする。転換が直接つながっている所には「＋5分」で、この後の転換を
// そのバンドの個別設定として延ばすショートカットを置く(余白ブロックで間隔を足すと、
// 余白には転換時間が付かず間隔がかえって短くなるため、余白の代わりにこちらを使う)。
// 間に余白が挟まって規定より短くなっている所には「余白を転換に置き換え」を出す。
export function ChangeoverBar({ dayId, info }: Props) {
  const fromBand = useAppStore((s) => (info.fromBandId ? s.bands.find((b) => b.id === info.fromBandId) : undefined));
  const updateBand = useAppStore((s) => s.updateBand);
  const convert = useAppStore((s) => s.convertMarginToChangeover);

  const short = info.gap < info.required;
  const actor = () => useCollabStore.getState().myNickname ?? "この端末";

  const extend = () => {
    if (!fromBand) return;
    setNextHistoryAction("転換時間を延長", actor());
    updateBand(fromBand.id, { customTransitionMinutes: info.required + 5 });
  };
  const reset = () => {
    if (!fromBand) return;
    setNextHistoryAction("転換時間を規定に戻す", actor());
    updateBand(fromBand.id, { customTransitionMinutes: undefined });
  };
  const replaceMargin = () => {
    if (!fromBand) return;
    setNextHistoryAction("余白を転換時間に置き換え", actor());
    convert(dayId, fromBand.id, info.marginSlotIds, info.required + info.marginMinutes);
  };

  const label = short
    ? `転換 ${info.gap}分（規定${info.required}分より短い）`
    : `転換 ${info.gap}分${info.viaMargin ? "（余白を含む）" : ""}`;

  const btn =
    "shrink-0 rounded border px-2 py-0.5 text-[11px] font-medium leading-tight min-h-7 md:min-h-0";

  return (
    <div
      role={short ? "alert" : undefined}
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded px-2 py-0.5 text-[11px] ${
        short
          ? "border border-rose-500 bg-rose-950/60 text-rose-200"
          : "text-slate-500"
      }`}
    >
      <span aria-hidden="true">{short ? "⚠" : "↕"}</span>
      <span className="font-medium">{label}</span>
      {info.viaMargin && short && (
        <span className="text-rose-300/90">余白には転換時間が入りません</span>
      )}
      <span className="ml-auto flex items-center gap-1">
        {fromBand && !info.viaMargin && (
          <button
            type="button"
            onClick={extend}
            className={`${btn} border-cyan-600 text-cyan-300 hover:bg-cyan-950/60`}
            title="このバンドの後の転換時間を5分延ばします（バンドの個別設定になります）"
          >
            ＋5分
          </button>
        )}
        {fromBand && !info.viaMargin && fromBand.customTransitionMinutes != null && (
          <button
            type="button"
            onClick={reset}
            className={`${btn} border-slate-600 text-slate-300 hover:bg-slate-800`}
            title="個別設定を外して、その日の規定の転換時間に戻します"
          >
            規定に戻す
          </button>
        )}
        {fromBand && info.viaMargin && short && (
          <button
            type="button"
            onClick={replaceMargin}
            className={`${btn} border-rose-400 bg-rose-900/60 text-rose-100 hover:bg-rose-800/70`}
            title={`余白を取り除き、転換時間を${info.required + info.marginMinutes}分（規定${info.required}分＋余白${info.marginMinutes}分）にします`}
          >
            余白を転換に置き換え
          </button>
        )}
      </span>
    </div>
  );
}
