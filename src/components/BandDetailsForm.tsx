import type { Band } from "../types";
import { useAppStore } from "../store/useAppStore";

type Props = { band: Band };

// The full editable field set for a band, shown inside BandChip's hover
// popover. No drag/chip chrome here — that lives in BandChip so the
// unplaced list can stay compact while still allowing full inline editing.
export function BandDetailsForm({ band }: Props) {
  const updateBand = useAppStore((s) => s.updateBand);
  const deleteBand = useAppStore((s) => s.deleteBand);
  const days = useAppStore((s) => s.days);
  const toggleBandDay = useAppStore((s) => s.toggleBandDay);

  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-2">
        <input
          className="w-full border-b border-transparent bg-transparent text-sm font-semibold text-slate-100 outline-none focus:border-slate-500"
          value={band.name}
          onChange={(e) => updateBand(band.id, { name: e.target.value })}
        />
        <button
          onClick={() => deleteBand(band.id)}
          className="flex h-9 w-9 shrink-0 items-center justify-center text-base text-slate-500 hover:text-rose-400"
          title="削除"
        >
          ×
        </button>
      </div>
      <input
        className="w-full border-b border-transparent bg-transparent text-xs text-slate-300 outline-none focus:border-slate-500"
        value={band.members.join(", ")}
        placeholder="メンバー（カンマ区切り）"
        onChange={(e) =>
          updateBand(band.id, {
            members: e.target.value
              .split(",")
              .map((m) => m.trim())
              .filter(Boolean),
          })
        }
      />
      <div className="flex gap-2 text-xs">
        <input
          className="flex-1 border-b border-transparent bg-transparent text-slate-400 outline-none focus:border-slate-500"
          value={band.desiredTime}
          placeholder="希望時間帯"
          onChange={(e) => updateBand(band.id, { desiredTime: e.target.value })}
        />
        <input
          className="flex-1 border-b border-transparent bg-transparent text-rose-400 outline-none focus:border-slate-500"
          value={band.ngTime}
          placeholder="NG時間帯"
          onChange={(e) => updateBand(band.id, { ngTime: e.target.value })}
        />
      </div>
      <div className="flex gap-2 text-xs">
        <input
          type="number"
          min={1}
          className="w-20 border-b border-transparent bg-transparent text-indigo-400 outline-none focus:border-slate-500"
          value={band.durationMinutes ?? ""}
          placeholder="演奏時間(分)"
          onChange={(e) =>
            updateBand(band.id, {
              durationMinutes: e.target.value ? Number(e.target.value) : undefined,
            })
          }
        />
        <input
          type="number"
          min={0}
          className="w-24 border-b border-transparent bg-transparent text-cyan-400 outline-none focus:border-slate-500"
          value={band.customTransitionMinutes ?? ""}
          placeholder="転換時間(分)"
          title="この後の転換時間を個別に上書きします（未入力なら全体設定を使用）"
          onChange={(e) =>
            updateBand(band.id, {
              customTransitionMinutes: e.target.value
                ? Number(e.target.value)
                : undefined,
            })
          }
        />
      </div>
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => updateBand(band.id, { hasSync: !band.hasSync })}
          className={`rounded border min-h-9 px-1.5 py-0.5 text-xs ${
            band.hasSync
              ? "border-violet-500 bg-violet-950/50 text-violet-300"
              : "border-slate-600 bg-slate-800 text-slate-500"
          }`}
          title="クリックして同期演奏の有無を切り替え"
        >
          🔌 同期
        </button>
        <button
          onClick={() => updateBand(band.id, { hasKeyboard: !band.hasKeyboard })}
          className={`rounded border min-h-9 px-1.5 py-0.5 text-xs ${
            band.hasKeyboard
              ? "border-sky-500 bg-sky-950/50 text-sky-300"
              : "border-slate-600 bg-slate-800 text-slate-500"
          }`}
          title="クリックしてキーボードの有無を切り替え"
        >
          🎹 Key
        </button>
      </div>
      {band.setlist.length > 0 && (
        <div className="rounded border border-slate-700 bg-slate-900 px-2 py-1">
          <p className="mb-0.5 text-xs font-semibold text-slate-400">
            🎵 セットリスト
          </p>
          <ul className="space-y-0.5 text-xs text-slate-300">
            {band.setlist.map((song, i) => (
              <li key={i} className="truncate">
                {song}
              </li>
            ))}
          </ul>
        </div>
      )}
      {days.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {days.map((day) => {
            const isAllowed =
              band.allowedDayIds.length === 0 ||
              band.allowedDayIds.includes(day.id);
            return (
              <button
                key={day.id}
                onClick={() => toggleBandDay(band.id, day.id)}
                className={`rounded border min-h-9 px-1.5 py-0.5 text-xs ${
                  isAllowed
                    ? "border-emerald-500 bg-emerald-950/50 text-emerald-300"
                    : "border-slate-600 bg-slate-800 text-slate-500 line-through"
                }`}
                title="クリックして出演可能日を切り替え"
              >
                {day.label}
              </button>
            );
          })}
        </div>
      )}
      {band.parseWarning && (
        <p className="text-xs text-amber-400">{band.parseWarning}</p>
      )}
    </div>
  );
}
