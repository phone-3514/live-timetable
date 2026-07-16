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
          className="w-full border-b border-transparent bg-transparent text-sm font-semibold text-slate-800 outline-none focus:border-slate-300"
          value={band.name}
          onChange={(e) => updateBand(band.id, { name: e.target.value })}
        />
        <button
          onClick={() => deleteBand(band.id)}
          className="shrink-0 text-sm text-slate-300 hover:text-rose-500"
          title="削除"
        >
          ×
        </button>
      </div>
      <input
        className="w-full border-b border-transparent bg-transparent text-xs text-slate-600 outline-none focus:border-slate-300"
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
          className="flex-1 border-b border-transparent bg-transparent text-slate-500 outline-none focus:border-slate-300"
          value={band.desiredTime}
          placeholder="希望時間帯"
          onChange={(e) => updateBand(band.id, { desiredTime: e.target.value })}
        />
        <input
          className="flex-1 border-b border-transparent bg-transparent text-rose-500 outline-none focus:border-slate-300"
          value={band.ngTime}
          placeholder="NG時間帯"
          onChange={(e) => updateBand(band.id, { ngTime: e.target.value })}
        />
      </div>
      <input
        type="number"
        min={1}
        className="w-24 border-b border-transparent bg-transparent text-xs text-indigo-500 outline-none focus:border-slate-300"
        value={band.durationMinutes ?? ""}
        placeholder="演奏時間(分)"
        onChange={(e) =>
          updateBand(band.id, {
            durationMinutes: e.target.value ? Number(e.target.value) : undefined,
          })
        }
      />
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => updateBand(band.id, { hasSync: !band.hasSync })}
          className={`rounded border px-1.5 py-0.5 text-xs ${
            band.hasSync
              ? "border-violet-300 bg-violet-50 text-violet-700"
              : "border-slate-200 bg-white text-slate-300"
          }`}
          title="クリックして同期演奏の有無を切り替え"
        >
          🔌 同期
        </button>
        <button
          onClick={() => updateBand(band.id, { hasKeyboard: !band.hasKeyboard })}
          className={`rounded border px-1.5 py-0.5 text-xs ${
            band.hasKeyboard
              ? "border-sky-300 bg-sky-50 text-sky-700"
              : "border-slate-200 bg-white text-slate-300"
          }`}
          title="クリックしてキーボードの有無を切り替え"
        >
          🎹 Key
        </button>
      </div>
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
                className={`rounded border px-1.5 py-0.5 text-xs ${
                  isAllowed
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-slate-100 text-slate-400 line-through"
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
        <p className="text-xs text-amber-700">{band.parseWarning}</p>
      )}
    </div>
  );
}
