import { useRef, useState } from "react";
import { toPng } from "html-to-image";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { getMemberConflictSlotIds, useAppStore } from "../store/useAppStore";
import { SlotCard } from "./SlotCard";
import { DayTabs } from "./DayTabs";

const CUSTOM_PRESETS = [
  { label: "休憩", minutes: 10 },
  { label: "集合", minutes: 15 },
  { label: "リハーサル", minutes: 20 },
];

export function Timetable() {
  const days = useAppStore((s) => s.days);
  const activeDayId = useAppStore((s) => s.activeDayId);
  const bands = useAppStore((s) => s.bands);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const addSlot = useAppStore((s) => s.addSlot);
  const addSlots = useAppStore((s) => s.addSlots);
  const addCustomSlot = useAppStore((s) => s.addCustomSlot);
  const autoScheduleDay = useAppStore((s) => s.autoScheduleDay);
  const [bulkCount, setBulkCount] = useState(5);

  const activeDay = days.find((d) => d.id === activeDayId) ?? days[0];
  const slots = activeDay.slots;
  const settings = activeDay.settings;

  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const conflicts = getMemberConflictSlotIds(slots, bands);
  const exportRef = useRef<HTMLDivElement>(null);

  const handleExportImage = async () => {
    const el = exportRef.current;
    if (!el) return;
    // The slot list scrolls internally so the page itself never does, but
    // that means toPng would otherwise only capture the currently visible,
    // clipped viewport. Briefly expand to full content height for the
    // capture, then restore the scrollable layout.
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
      link.download = `timetable-${activeDay.label}.png`;
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
    await navigator.clipboard.writeText(
      [`${activeDay.label}`, ...lines].join("\n"),
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-3">
        <DayTabs />

        <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-700 bg-slate-900 p-3">
          <label className="flex flex-col gap-1 text-sm text-slate-400">
            開始時刻
            <input
              type="time"
              aria-label="1枠目の開始時刻"
              value={settings.startTime}
              onChange={(e) =>
                updateSettings(activeDay.id, { startTime: e.target.value })
              }
              className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-100"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-400">
            演奏時間（分）
            <input
              type="number"
              min={1}
              value={settings.performanceMinutes}
              onChange={(e) =>
                updateSettings(activeDay.id, {
                  performanceMinutes: Number(e.target.value),
                })
              }
              className="w-24 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-100"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-400">
            転換時間（分）
            <input
              type="number"
              min={0}
              value={settings.transitionMinutes}
              onChange={(e) =>
                updateSettings(activeDay.id, {
                  transitionMinutes: Number(e.target.value),
                })
              }
              className="w-24 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-100"
            />
          </label>
          <button
            onClick={() => autoScheduleDay(activeDay.id)}
            className="ml-auto rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
            title="希望日程・出演可能時間・機材転換の条件を考慮して、空き枠に未配置のバンドを自動で割り振ります"
          >
            ⚡ 自動配置
          </button>
          <button
            onClick={handleCopyText}
            className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
          >
            テキストをコピー
          </button>
          <button
            onClick={handleExportImage}
            className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
          >
            画像を保存
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">枠を追加：</span>
          <button
            onClick={() => addSlot(activeDay.id)}
            className="rounded bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-500"
          >
            + 演奏枠
          </button>
          <div className="flex items-center rounded border border-indigo-600 overflow-hidden">
            <input
              type="number"
              min={1}
              max={99}
              value={bulkCount}
              onChange={(e) => setBulkCount(Number(e.target.value))}
              aria-label="一括追加する演奏枠数"
              className="w-12 bg-slate-800 px-2 py-1.5 text-center text-slate-100 outline-none"
            />
            <button
              onClick={() => addSlots(activeDay.id, bulkCount)}
              className="bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-500"
            >
              枠を一括追加
            </button>
          </div>
          {CUSTOM_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() =>
                addCustomSlot(activeDay.id, preset.label, preset.minutes)
              }
              className="rounded border border-amber-600 bg-amber-900/40 px-3 py-1.5 text-amber-300 hover:bg-amber-800/50"
            >
              + {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={exportRef}
        className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-slate-900 p-2"
      >
        {slots.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-700 p-4 text-center text-sm text-slate-500">
            上のボタンでタイムテーブルの枠を作成してください
          </p>
        )}
        {/* Two columns so a full day's schedule fits on one screen: the
            first half of slots (by array order) renders in the left
            column, the second half in the right, while a single
            SortableContext spanning both keeps drag-reordering working
            across the whole list — rectSortingStrategy resolves "closest
            slot" from actual on-screen position rather than assuming one
            visual column, so it still works split like this. */}
        <SortableContext
          items={slots.map((s) => s.id)}
          strategy={rectSortingStrategy}
        >
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            <div className="flex flex-col gap-2">
              {slots.slice(0, Math.ceil(slots.length / 2)).map((slot, i) => (
                <SlotCard
                  key={slot.id}
                  dayId={activeDay.id}
                  slot={slot}
                  band={slot.bandId ? bandMap.get(slot.bandId) : undefined}
                  index={i}
                  total={slots.length}
                  conflict={conflicts.has(slot.id)}
                />
              ))}
            </div>
            <div className="flex flex-col gap-2">
              {slots.slice(Math.ceil(slots.length / 2)).map((slot, i) => {
                const index = Math.ceil(slots.length / 2) + i;
                return (
                  <SlotCard
                    key={slot.id}
                    dayId={activeDay.id}
                    slot={slot}
                    band={slot.bandId ? bandMap.get(slot.bandId) : undefined}
                    index={index}
                    total={slots.length}
                    conflict={conflicts.has(slot.id)}
                  />
                );
              })}
            </div>
          </div>
        </SortableContext>
      </div>
    </div>
  );
}
