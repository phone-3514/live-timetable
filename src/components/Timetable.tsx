import { useRef } from "react";
import { toPng } from "html-to-image";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { getMemberConflictSlotIds, useAppStore } from "../store/useAppStore";
import { SlotCard } from "./SlotCard";

const CUSTOM_PRESETS = [
  { label: "休憩", minutes: 10 },
  { label: "集合", minutes: 15 },
  { label: "リハーサル", minutes: 20 },
];

export function Timetable() {
  const slots = useAppStore((s) => s.slots);
  const bands = useAppStore((s) => s.bands);
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const addSlot = useAppStore((s) => s.addSlot);
  const addCustomSlot = useAppStore((s) => s.addCustomSlot);

  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const conflicts = getMemberConflictSlotIds(slots, bands);
  const exportRef = useRef<HTMLDivElement>(null);

  const handleExportImage = async () => {
    if (!exportRef.current) return;
    const dataUrl = await toPng(exportRef.current, {
      backgroundColor: "#ffffff",
      pixelRatio: 2,
    });
    const link = document.createElement("a");
    link.download = "timetable.png";
    link.href = dataUrl;
    link.click();
  };

  const handleCopyText = async () => {
    const lines = slots.map((slot) => {
      const label = slot.bandId
        ? (bandMap.get(slot.bandId)?.name ?? "(未定)")
        : (slot.customLabel ?? "(未定)");
      return `${slot.startTime}-${slot.endTime}  ${label}`;
    });
    await navigator.clipboard.writeText(lines.join("\n"));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          開始時刻
          <input
            type="time"
            value={settings.startTime}
            onChange={(e) => updateSettings({ startTime: e.target.value })}
            className="rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          演奏時間（分）
          <input
            type="number"
            min={1}
            value={settings.performanceMinutes}
            onChange={(e) =>
              updateSettings({ performanceMinutes: Number(e.target.value) })
            }
            className="w-24 rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          転換時間（分）
          <input
            type="number"
            min={0}
            value={settings.transitionMinutes}
            onChange={(e) =>
              updateSettings({ transitionMinutes: Number(e.target.value) })
            }
            className="w-24 rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <button
          onClick={handleCopyText}
          className="ml-auto rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
        >
          テキストをコピー
        </button>
        <button
          onClick={handleExportImage}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
        >
          画像を保存
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">枠を追加：</span>
        <button
          onClick={addSlot}
          className="rounded bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700"
        >
          + 演奏枠
        </button>
        {CUSTOM_PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => addCustomSlot(preset.label, preset.minutes)}
            className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-700 hover:bg-amber-100"
          >
            + {preset.label}
          </button>
        ))}
      </div>

      <div ref={exportRef} className="flex flex-col gap-2 bg-white p-2">
        {slots.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-sm text-slate-400">
            上のボタンでタイムテーブルの枠を作成してください
          </p>
        )}
        <SortableContext
          items={slots.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          {slots.map((slot, i) => (
            <SlotCard
              key={slot.id}
              slot={slot}
              band={slot.bandId ? bandMap.get(slot.bandId) : undefined}
              index={i}
              total={slots.length}
              conflict={conflicts.has(slot.id)}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}
