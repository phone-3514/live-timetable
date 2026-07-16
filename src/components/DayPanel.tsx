import { useRef, useState } from "react";
import { toPng } from "html-to-image";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { getMemberConflictSlotIds, useAppStore } from "../store/useAppStore";
import { SlotCard } from "./SlotCard";
import type { TimetableDay } from "../types";

const CUSTOM_PRESETS = [
  { label: "休憩", minutes: 10 },
  { label: "集合", minutes: 15 },
  { label: "リハーサル", minutes: 20 },
];

type Props = { day: TimetableDay; daysCount: number };

// One day's whole timetable UI — label/date, settings, slot-add controls,
// and the slot list itself. Rendered side by side per day (see Timetable),
// each internally scrollable so N days can share one 100vh screen.
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

  const slots = day.slots;
  const settings = day.settings;
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const conflicts = getMemberConflictSlotIds(slots, bands);
  const exportRef = useRef<HTMLDivElement>(null);

  const handleExportImage = async () => {
    const el = exportRef.current;
    if (!el) return;
    const prevHeight = el.style.height;
    const prevFlex = el.style.flex;
    const prevOverflow = el.style.overflow;
    el.style.height = "auto";
    el.style.flex = "none";
    el.style.overflow = "visible";
    await new Promise((resolve) => requestAnimationFrame(resolve));
    try {
      const dataUrl = await toPng(el, {
        backgroundColor: "#0f172a",
        pixelRatio: 2,
      });
      const link = document.createElement("a");
      link.download = `timetable-${day.label}.png`;
      link.href = dataUrl;
      link.click();
    } finally {
      el.style.height = prevHeight;
      el.style.flex = prevFlex;
      el.style.overflow = prevOverflow;
    }
  };

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
          className="w-28 bg-transparent text-xs text-slate-500 outline-none"
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
          onClick={handleExportImage}
          className="rounded border border-slate-600 px-2 py-1 text-slate-200 hover:bg-slate-800"
        >
          画像保存
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
        ref={exportRef}
        className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-slate-900 p-1.5"
      >
        {slots.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-700 p-3 text-center text-xs text-slate-500">
            上のボタンで枠を作成してください
          </p>
        )}
        <SortableContext
          items={slots.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col gap-1.5">
            {slots.map((slot, i) => (
              <SlotCard
                key={slot.id}
                dayId={day.id}
                slot={slot}
                band={slot.bandId ? bandMap.get(slot.bandId) : undefined}
                index={i}
                total={slots.length}
                conflict={conflicts.has(slot.id)}
              />
            ))}
          </div>
        </SortableContext>
      </div>
    </div>
  );
}
