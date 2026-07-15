import { useAppStore } from "../store/useAppStore";

export function DayTabs() {
  const days = useAppStore((s) => s.days);
  const activeDayId = useAppStore((s) => s.activeDayId);
  const setActiveDay = useAppStore((s) => s.setActiveDay);
  const renameDay = useAppStore((s) => s.renameDay);
  const addDay = useAppStore((s) => s.addDay);
  const removeDay = useAppStore((s) => s.removeDay);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {days.map((day) => {
        const isActive = day.id === activeDayId;
        return (
          <div
            key={day.id}
            onClick={() => setActiveDay(day.id)}
            className={`flex items-center gap-1 rounded-lg border px-2 py-1 ${
              isActive
                ? "border-indigo-400 bg-indigo-50"
                : "border-slate-200 bg-white hover:bg-slate-50"
            }`}
          >
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
        );
      })}
      <button
        onClick={addDay}
        className="rounded-lg border border-dashed border-slate-300 px-3 py-1 text-sm text-slate-500 hover:bg-slate-50"
      >
        + 日を追加
      </button>
    </div>
  );
}
