import { useLayoutEffect, useRef, useState } from "react";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { getMemberConflictSlotIds, useAppStore } from "../store/useAppStore";
import { SlotCard } from "./SlotCard";
import { SharePreviewModal } from "./SharePreviewModal";
import type { TimetableDay } from "../types";

const CUSTOM_PRESETS = [
  { label: "休憩", minutes: 10 },
  { label: "集合", minutes: 15 },
  { label: "リハーサル", minutes: 20 },
];

// Rough measured height of one SlotCard row including its gap, used to
// figure out how many rows fit in the available height without scrolling.
// An estimate rather than a per-row measurement — rows are fairly uniform
// height in the live UI (band names truncate to one line here, unlike the
// share image), so this stays close enough in practice.
// Measured empirically at ~59-60px content height + 6px gap; rounded up a
// bit further as a safety margin so the estimate errs toward wrapping one
// column early rather than slightly overflowing a nearly-full one.
const ROW_HEIGHT_PX = 70;
const MIN_COLUMN_WIDTH_PX = 300;

type Props = { day: TimetableDay; daysCount: number };

// One day's whole timetable UI — label/date, settings, slot-add controls,
// and the slot list itself. Rendered side by side per day (see Timetable).
// The slot list no longer scrolls vertically: it wraps into as many
// columns as fit the day panel's available height, growing sideways
// (with its own horizontal scroll as a last resort) instead of forcing
// everything into one long scrolling strip.
export function DayPanel({ day, daysCount }: Props) {
  const bands = useAppStore((s) => s.bands);
  const renameDay = useAppStore((s) => s.renameDay);
  const updateDayDate = useAppStore((s) => s.updateDayDate);
  const removeDay = useAppStore((s) => s.removeDay);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const addSlot = useAppStore((s) => s.addSlot);
  const addSlots = useAppStore((s) => s.addSlots);
  const addCustomSlot = useAppStore((s) => s.addCustomSlot);
  const [bulkCount, setBulkCount] = useState(5);
  const [showSharePreview, setShowSharePreview] = useState(false);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const [rowsPerColumn, setRowsPerColumn] = useState(8);

  useLayoutEffect(() => {
    const el = listContainerRef.current;
    if (!el) return;
    const update = () => {
      setRowsPerColumn(Math.max(1, Math.floor(el.clientHeight / ROW_HEIGHT_PX)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const slots = day.slots;
  const settings = day.settings;
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const conflicts = getMemberConflictSlotIds(slots, bands);

  const handleCopyText = async () => {
    const lines = slots.map((slot) => {
      const label = slot.bandId
        ? (bandMap.get(slot.bandId)?.name ?? "(未定)")
        : (slot.customLabel ?? "(未定)");
      return `${slot.startTime}-${slot.endTime}  ${label}`;
    });
    await navigator.clipboard.writeText([day.label, ...lines].join("\n"));
  };

  return (
    <div className="flex min-h-0 flex-col gap-1.5 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40 p-2">
      <div className="flex shrink-0 items-center gap-1.5">
        <input
          value={day.label}
          onChange={(e) => renameDay(day.id, e.target.value)}
          className="w-14 bg-transparent text-sm font-semibold text-indigo-300 outline-none"
        />
        <input
          type="date"
          value={day.date ?? ""}
          onChange={(e) => updateDayDate(day.id, e.target.value || null)}
          onClick={(e) => {
            // Native <input type="date"> only reliably opens its calendar
            // when the tiny built-in icon is clicked precisely. Calling
            // showPicker() on any click turns the whole (now much larger)
            // field into one big "open calendar" button.
            e.currentTarget.showPicker?.();
          }}
          title="クリックして日付を変更"
          className="w-36 cursor-pointer rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-200 outline-none transition-colors hover:border-indigo-500 hover:bg-slate-700 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:scale-125"
        />
        {daysCount > 1 && (
          <button
            onClick={() => removeDay(day.id)}
            className="ml-auto text-xs text-slate-500 hover:text-rose-400"
            title="この日を削除"
          >
            ×
          </button>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-end gap-1.5 rounded border border-slate-700 bg-slate-900 p-1.5 text-xs">
        <label className="flex flex-col gap-0.5 text-slate-400">
          開始
          <input
            type="time"
            value={settings.startTime}
            onChange={(e) =>
              updateSettings(day.id, { startTime: e.target.value })
            }
            className="w-24 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-slate-100"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-slate-400">
          演奏(分)
          <input
            type="number"
            min={1}
            value={settings.performanceMinutes}
            onChange={(e) =>
              updateSettings(day.id, {
                performanceMinutes: Number(e.target.value),
              })
            }
            className="w-14 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-slate-100"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-slate-400">
          転換(分)
          <input
            type="number"
            min={0}
            value={settings.transitionMinutes}
            onChange={(e) =>
              updateSettings(day.id, {
                transitionMinutes: Number(e.target.value),
              })
            }
            className="w-14 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-slate-100"
          />
        </label>
        <button
          onClick={handleCopyText}
          className="ml-auto rounded border border-slate-600 px-2 py-1 text-slate-200 hover:bg-slate-800"
        >
          コピー
        </button>
        <button
          onClick={() => setShowSharePreview(true)}
          className="rounded border border-indigo-600 bg-indigo-950/40 px-2 py-1 text-indigo-300 hover:bg-indigo-900/50"
        >
          🎨 共有用画像
        </button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1 text-xs">
        <button
          onClick={() => addSlot(day.id)}
          className="rounded bg-indigo-600 px-2 py-1 text-white hover:bg-indigo-500"
        >
          + 演奏枠
        </button>
        <div className="flex items-center overflow-hidden rounded border border-indigo-600">
          <input
            type="number"
            min={1}
            max={99}
            value={bulkCount}
            onChange={(e) => setBulkCount(Number(e.target.value))}
            aria-label={`${day.label}に一括追加する演奏枠数`}
            className="w-9 bg-slate-800 px-1 py-1 text-center text-slate-100 outline-none"
          />
          <button
            onClick={() => addSlots(day.id, bulkCount)}
            className="bg-indigo-600 px-2 py-1 text-white hover:bg-indigo-500"
          >
            一括追加
          </button>
        </div>
        {CUSTOM_PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => addCustomSlot(day.id, preset.label, preset.minutes)}
            className="rounded border border-amber-600 bg-amber-900/40 px-2 py-1 text-amber-300 hover:bg-amber-800/50"
          >
            +{preset.label}
          </button>
        ))}
      </div>

      <div
        ref={listContainerRef}
        // No vertical scroll — the list wraps into columns (below) that
        // fill this container's height instead. Horizontal scroll is the
        // fallback once there are more bands than fit in that many
        // columns at a readable width, rather than shrinking anything.
        className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden rounded-lg bg-slate-900 p-1.5"
      >
        {slots.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-700 p-3 text-center text-xs text-slate-500">
            上のボタンで枠を作成してください
          </p>
        ) : (
          <SortableContext items={slots.map((s) => s.id)} strategy={rectSortingStrategy}>
            <div className="flex h-full gap-1.5">
              {(() => {
                // Performance order only counts slots that actually have a
                // band (breaks/custom slots and empty slots don't get a
                // number), computed once over the full original order so
                // it stays correct regardless of which column a slot lands
                // in visually.
                const orderById = new Map<string, number>();
                let order = 0;
                for (const slot of slots) {
                  const band = slot.bandId ? bandMap.get(slot.bandId) : undefined;
                  if (band) orderById.set(slot.id, ++order);
                }

                // Column-major chunking: column 0 gets the first
                // rowsPerColumn slots (top to bottom), column 1 the next
                // batch, and so on — new columns appear as needed instead
                // of the list growing (and scrolling) downward.
                const columns: typeof slots[] = [];
                for (let i = 0; i < slots.length; i += rowsPerColumn) {
                  columns.push(slots.slice(i, i + rowsPerColumn));
                }

                return columns.map((column, colIndex) => (
                  <div
                    key={colIndex}
                    className="flex shrink-0 flex-col gap-1.5"
                    style={{ width: MIN_COLUMN_WIDTH_PX }}
                  >
                    {column.map((slot, rowIndex) => {
                      const globalIndex = colIndex * rowsPerColumn + rowIndex;
                      const band = slot.bandId ? bandMap.get(slot.bandId) : undefined;
                      return (
                        <SlotCard
                          key={slot.id}
                          dayId={day.id}
                          slot={slot}
                          band={band}
                          index={globalIndex}
                          total={slots.length}
                          conflict={conflicts.has(slot.id)}
                          performanceOrder={orderById.get(slot.id) ?? null}
                        />
                      );
                    })}
                  </div>
                ));
              })()}
            </div>
          </SortableContext>
        )}
      </div>

      {showSharePreview && (
        <SharePreviewModal day={day} onClose={() => setShowSharePreview(false)} />
      )}
    </div>
  );
}
