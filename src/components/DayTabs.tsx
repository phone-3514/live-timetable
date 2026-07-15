import { useAppStore } from "../store/useAppStore";

export function DayTabs() {
  const days = useAppStore((s) => s.days);
  const activeDayId = useAppStore((s) => s.activeDayId);
  const setActiveDay = useAppStore((s) => s.setActiveDay);
  const renameDay = useAppStore((s) => s.renameDay);
  const updateDayDate = useAppStore((s) => s.updateDayDate);
  const addDay = useAppStore((s) => s.addDay);
  const removeDay = useAppStore((s) => s.removeDay);
  const autoDetectDayRestrictions = useAppStore(
    (s) => s.autoDetectDayRestrictions,
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {days.map((day) => {
        const isActive = day.id === activeDayId;
        return (
          <div
            key={day.id}
            onClick={() => setActiveDay(day.id)}
            className={`flex flex-col gap-0.5 rounded-lg border px-2 py-1 ${
              isActive
                ? "border-indigo-400 bg-indigo-50"
                : "border-slate-200 bg-white hover:bg-slate-50"
            }`}
          >
            <div className="flex items-center gap-1">
              <input
                value={day.label}
                onChange={(e) => renameDay(day.id, e.target.value)}
                onFocus={() => setActiveDay(day.id)}
                className={`w-16 bg-transparent text-sm outline-none ${
                  isActive ? "font-semibold text-indigo-700" : "text-slate-500"
                }`}
              />
              {days.length > 1 && (
                <button
                  onClick={() => removeDay(day.id)}
                  className="text-xs text-slate-300 hover:text-rose-500"
                  title="この日を削除"
                >
                  ×
                </button>
              )}
            </div>
            <input
              type="date"
              value={day.date ?? ""}
              onChange={(e) =>
                updateDayDate(day.id, e.target.value || null)
              }
              onFocus={() => setActiveDay(day.id)}
              onClick={(e) => e.stopPropagation()}
              className="w-32 bg-transparent text-xs text-slate-400 outline-none"
            />
          </div>
        );
      })}
      <button
        onClick={addDay}
        className="self-start rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50"
      >
        + 日を追加
      </button>
      <button
        onClick={autoDetectDayRestrictions}
        className="self-start rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-400 hover:bg-slate-50"
        title="通常は不要です（貼り付け・希望/NG時間帯の編集・日付の設定のたびに自動で判定されます）。バンドカードで手動変更した出演可能日を、希望/NG時間帯のテキストが示す内容にリセットしたいときに使います"
      >
        日程を再判定（リセット）
      </button>
    </div>
  );
}
