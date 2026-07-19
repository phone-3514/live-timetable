import { useState } from "react";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  getConcentrationWarningDetails,
  getGearConflictSlotIds,
  getMemberConflictDetails,
  useAppStore,
} from "../store/useAppStore";
import { useToastStore } from "../store/useToastStore";
import { SlotCard } from "./SlotCard";
import { SharePreviewModal } from "./SharePreviewModal";
import { SetlistExportModal } from "./SetlistExportModal";
import type { TimetableDay } from "../types";

// Strips the "HH:MM-HH:MM  " prefix handleCopyText below writes onto every
// line, and drops a leading line that's just the day's own label — so
// pasting back either the *exact* text "コピー" produced (reordered in a
// text editor) or a plain hand-typed list of band names both work the same
// way for reorderDayBandsByNames.
function parseBandNamesFromPastedText(dayLabel: string, text: string): string[] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const withoutHeader = lines[0] === dayLabel ? lines.slice(1) : lines;
  return withoutHeader.map((line) =>
    line.replace(/^\d{1,2}:\d{2}-\d{1,2}:\d{2}\s+/, "").trim(),
  );
}

const CUSTOM_PRESETS = [
  { label: "休憩", minutes: 10 },
  { label: "集合", minutes: 15 },
  { label: "リハーサル", minutes: 20 },
];

type Props = { day: TimetableDay; daysCount: number };

// One day's whole timetable UI — label/date, settings, slot-add controls,
// and the slot list itself. Rendered side by side per day (see Timetable).
// The slot list is a single scrollable column — multi-column experiments
// here (unbounded columns sized from a runtime height measurement, then a
// fixed two-column split) both made drag-and-drop reordering less direct
// than a plain top-to-bottom list, so this reverts to that simpler shape.
export function DayPanel({ day, daysCount }: Props) {
  const bands = useAppStore((s) => s.bands);
  const renameDay = useAppStore((s) => s.renameDay);
  const updateDayDate = useAppStore((s) => s.updateDayDate);
  const removeDay = useAppStore((s) => s.removeDay);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const addSlot = useAppStore((s) => s.addSlot);
  const addSlots = useAppStore((s) => s.addSlots);
  const addCustomSlot = useAppStore((s) => s.addCustomSlot);
  const reorderDayBandsByNames = useAppStore((s) => s.reorderDayBandsByNames);
  const showToast = useToastStore((s) => s.show);
  const [bulkCount, setBulkCount] = useState(5);
  const [showSharePreview, setShowSharePreview] = useState(false);
  const [showSetlistExport, setShowSetlistExport] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customMinutes, setCustomMinutes] = useState(10);

  const slots = day.slots;
  const settings = day.settings;
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const conflictDetails = getMemberConflictDetails(day, bands);
  const gearConflicts = getGearConflictSlotIds(day, bands);
  const concentrationDetails = getConcentrationWarningDetails(day, bands);

  const handleAddCustomNamed = () => {
    const label = customName.trim();
    if (!label) return;
    addCustomSlot(day.id, label, customMinutes);
    setCustomName("");
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

  const handlePasteReorder = async () => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      showToast(
        "クリップボードを読み取れませんでした。ブラウザの権限設定を確認してください",
        "error",
      );
      return;
    }
    const names = parseBandNamesFromPastedText(day.label, text);
    const placedBandNames = new Set(
      slots
        .filter((s) => s.bandId !== null)
        .map((s) => bandMap.get(s.bandId!)?.name)
        .filter((name): name is string => !!name),
    );
    const matchedCount = names.filter((n) => placedBandNames.has(n.trim())).length;
    if (matchedCount === 0) {
      showToast(
        "この日に配置されているバンド名と一致する行が見つかりませんでした",
        "error",
      );
      return;
    }
    reorderDayBandsByNames(day.id, names);
    const skipped = names.length - matchedCount;
    showToast(
      `${matchedCount}件を並び替えました${skipped > 0 ? `（${skipped}件は一致せずスキップ）` : ""}`,
      "success",
    );
  };

  return (
    <div className="flex h-[75vh] flex-col gap-1.5 overflow-hidden rounded-lg border border-slate-700 bg-slate-900/40 p-2 shadow-[0_4px_12px_rgba(0,0,0,0.06)] md:h-auto md:min-h-0">
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
          className="min-h-11 w-36 cursor-pointer rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-200 outline-none transition-colors hover:border-indigo-500 hover:bg-slate-700 md:min-h-0 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:scale-125"
        />
        {daysCount > 1 && (
          <button
            onClick={() => removeDay(day.id)}
            className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center text-base text-slate-500 hover:text-rose-400 md:h-auto md:w-auto md:text-xs"
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
            className="min-h-11 w-24 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-slate-100 md:min-h-0"
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
            className="min-h-11 w-14 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-slate-100 md:min-h-0"
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
            className="min-h-11 w-14 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-slate-100 md:min-h-0"
          />
        </label>
        <button
          onClick={handleCopyText}
          className="min-h-11 rounded border border-slate-600 px-2 text-slate-200 hover:bg-slate-700 md:ml-auto md:min-h-0 md:py-1"
        >
          コピー
        </button>
        <button
          onClick={handlePasteReorder}
          title="コピーしたテキストの行順を編集してから貼り付けると、その順番にバンドを並び替えます"
          className="min-h-11 rounded border border-slate-600 px-2 text-slate-200 hover:bg-slate-700 md:min-h-0 md:py-1"
        >
          貼り付けて並び替え
        </button>
        <button
          onClick={() => setShowSharePreview(true)}
          className="min-h-11 rounded border border-indigo-600 bg-indigo-950/40 px-2 text-indigo-300 hover:bg-indigo-900/50 md:min-h-0 md:py-1"
        >
          🎨 共有用画像
        </button>
        <button
          onClick={() => setShowSetlistExport(true)}
          className="min-h-11 rounded border border-emerald-600 bg-emerald-950/40 px-2 text-emerald-300 hover:bg-emerald-900/50 md:min-h-0 md:py-1"
        >
          📋 セットリストを出力
        </button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1 text-xs">
        <button
          onClick={() => addSlot(day.id)}
          className="min-h-11 rounded bg-indigo-600 px-2 text-white hover:bg-indigo-500 md:min-h-0 md:py-1"
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
            className="min-h-11 w-9 bg-slate-800 px-1 text-center text-slate-100 outline-none md:min-h-0 md:py-1"
          />
          <button
            onClick={() => addSlots(day.id, bulkCount)}
            className="min-h-11 bg-indigo-600 px-2 text-white hover:bg-indigo-500 md:min-h-0 md:py-1"
          >
            一括追加
          </button>
        </div>
        {CUSTOM_PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => addCustomSlot(day.id, preset.label, preset.minutes)}
            className="min-h-11 rounded border border-amber-600 bg-amber-900/40 px-2 text-amber-300 hover:bg-amber-800/50 md:min-h-0 md:py-1"
          >
            +{preset.label}
          </button>
        ))}
      </div>

      {/* Arbitrary-name non-band events (準備・顔合わせ・写真撮影 etc.) —
          same addCustomSlot as the presets above, so they're identical in
          every way that matters: no transition time gets added after them
          (recomputeTimes only adds one after a slot with a real bandId),
          and the duration is set here, before the event is even added. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
        <input
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAddCustomNamed();
          }}
          placeholder="例：準備、写真撮影"
          aria-label={`${day.label}に追加する任意の非演奏枠の名前`}
          className="min-h-11 w-32 rounded border border-slate-600 bg-slate-800 px-2 text-slate-100 outline-none placeholder:text-slate-500 focus:border-indigo-500 md:min-h-0 md:py-1"
        />
        <div className="flex items-center overflow-hidden rounded border border-slate-600">
          <input
            type="number"
            min={1}
            max={999}
            value={customMinutes}
            onChange={(e) => setCustomMinutes(Number(e.target.value))}
            aria-label={`${day.label}に追加する任意の非演奏枠の所要時間（分）`}
            className="min-h-11 w-12 bg-slate-800 px-1.5 text-center text-slate-100 outline-none md:min-h-0 md:py-1"
          />
          <span className="bg-slate-800 px-1.5 py-1 text-slate-400">分</span>
        </div>
        <button
          onClick={handleAddCustomNamed}
          disabled={!customName.trim()}
          className="min-h-11 rounded bg-slate-600 px-2 font-medium text-white hover:bg-slate-500 disabled:cursor-not-allowed disabled:opacity-40 md:min-h-0 md:py-1"
        >
          + 追加
        </button>
      </div>

      <div className="min-h-0 flex-1 rounded-lg bg-slate-900 p-1.5">
        {slots.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-700 p-3 text-center text-xs text-slate-500">
            上のボタンで枠を作成してください
          </p>
        ) : (
          <SortableContext
            items={slots.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex h-full flex-col gap-1.5 overflow-y-auto pr-1">
              {(() => {
                // Performance order only counts slots that actually have a
                // band (breaks/custom slots and empty slots don't get a
                // number), recomputed fresh from the current slot order on
                // every render, so reordering or dropping a band in always
                // keeps the numbering correct automatically.
                let order = 0;
                return slots.map((slot, i) => {
                  const band = slot.bandId ? bandMap.get(slot.bandId) : undefined;
                  if (band) order++;
                  return (
                    <SlotCard
                      key={slot.id}
                      dayId={day.id}
                      slot={slot}
                      band={band}
                      index={i}
                      total={slots.length}
                      conflicts={conflictDetails.get(slot.id) ?? []}
                      gearConflict={gearConflicts.has(slot.id)}
                      concentrationEntries={concentrationDetails.get(slot.id) ?? []}
                      performanceOrder={band ? order : null}
                    />
                  );
                });
              })()}
            </div>
          </SortableContext>
        )}
      </div>

      {showSharePreview && (
        <SharePreviewModal day={day} onClose={() => setShowSharePreview(false)} />
      )}
      {showSetlistExport && (
        <SetlistExportModal day={day} onClose={() => setShowSetlistExport(false)} />
      )}
    </div>
  );
}
