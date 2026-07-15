import { useDraggable } from "@dnd-kit/core";
import type { Band } from "../types";
import { useAppStore } from "../store/useAppStore";

type Props = { band: Band };

export function BandCard({ band }: Props) {
  const updateBand = useAppStore((s) => s.updateBand);
  const deleteBand = useAppStore((s) => s.deleteBand);
  const days = useAppStore((s) => s.days);
  const toggleBandDay = useAppStore((s) => s.toggleBandDay);
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: `band:${band.id}` });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-lg border p-3 bg-white shadow-sm ${
        isDragging ? "opacity-50 relative z-50" : ""
      } ${band.parseWarning ? "border-amber-400 bg-amber-50" : "border-slate-200"}`}
    >
      <div className="flex items-start gap-2">
        <div
          {...listeners}
          {...attributes}
          className="cursor-grab select-none pt-1 text-slate-400 active:cursor-grabbing"
          title="ドラッグしてタイムテーブルに配置"
        >
          ⠿
        </div>
        <div className="flex-1 space-y-1">
          <input
            className="w-full border-b border-transparent bg-transparent font-semibold text-slate-800 outline-none focus:border-slate-300"
            value={band.name}
            onChange={(e) => updateBand(band.id, { name: e.target.value })}
          />
          <input
            className="w-full border-b border-transparent bg-transparent text-sm text-slate-600 outline-none focus:border-slate-300"
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
              onChange={(e) =>
                updateBand(band.id, { desiredTime: e.target.value })
              }
            />
            <input
              className="flex-1 border-b border-transparent bg-transparent text-rose-500 outline-none focus:border-slate-300"
              value={band.ngTime}
              placeholder="NG時間帯"
              onChange={(e) =>
                updateBand(band.id, { ngTime: e.target.value })
              }
            />
            <input
              type="number"
              min={1}
              className="w-20 border-b border-transparent bg-transparent text-indigo-500 outline-none focus:border-slate-300"
              value={band.durationMinutes ?? ""}
              placeholder="演奏時間(分)"
              onChange={(e) =>
                updateBand(band.id, {
                  durationMinutes: e.target.value
                    ? Number(e.target.value)
                    : undefined,
                })
              }
            />
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
        <button
          onClick={() => deleteBand(band.id)}
          className="text-sm text-slate-300 hover:text-rose-500"
          title="削除"
        >
          ×
        </button>
      </div>
    </div>
  );
}
