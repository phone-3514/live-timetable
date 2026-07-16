import { useState } from "react";
import { useDndContext, useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { canPlaceBandInSlot, useAppStore } from "../store/useAppStore";
import type { Band, TimetableSlot } from "../types";

type Props = {
  dayId: string;
  slot: TimetableSlot;
  band: Band | undefined;
  index: number;
  total: number;
  conflict: boolean;
  performanceOrder: number | null;
};

export function SlotCard({
  dayId,
  slot,
  band,
  index,
  total,
  conflict,
  performanceOrder,
}: Props) {
  const [showSetlist, setShowSetlist] = useState(false);
  const moveSlot = useAppStore((s) => s.moveSlot);
  const removeSlot = useAppStore((s) => s.removeSlot);
  const updateSlotContent = useAppStore((s) => s.updateSlotContent);
  const day = useAppStore((s) => s.days.find((d) => d.id === dayId));
  const bands = useAppStore((s) => s.bands);
  const venueHours = useAppStore((s) => s.venueHours);

  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: slot.id, data: { type: "slot", slot, band } });

  const bandDraggable = useDraggable({
    id: band ? `band:${band.id}` : `empty-band:${slot.id}`,
    disabled: !band,
    data: band ? { type: "band", band } : undefined,
  });

  const { active } = useDndContext();
  const draggedBandId =
    typeof active?.id === "string" && active.id.startsWith("band:")
      ? active.id.slice("band:".length)
      : null;
  const draggedBand = draggedBandId
    ? bands.find((b) => b.id === draggedBandId)
    : undefined;
  const isDraggingBand = draggedBandId !== null;
  const isBlockedForDraggedBand =
    isDraggingBand && day && draggedBand
      ? !canPlaceBandInSlot(draggedBand, day, slot, venueHours)
      : false;

  const isCustom = slot.customLabel !== null;
  const showBlockedHighlight = isOver && isBlockedForDraggedBand;
  const showDropHighlight = isOver && !isBlockedForDraggedBand;
  // While a band is being dragged, every OTHER eligible slot gets a subtle
  // tint too (not just the one directly under the cursor) so the whole set
  // of placeable options is visible at a glance, not just discovered one
  // hover at a time.
  const showAmbientEligible = isDraggingBand && !isBlockedForDraggedBand && !isOver;

  const rowStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={rowStyle}
      className={`relative flex items-stretch gap-1.5 rounded-lg border p-1.5 ${
        isDragging ? "opacity-40" : ""
      } ${
        showBlockedHighlight
          ? "border-rose-500 bg-rose-950/40"
          : showDropHighlight
            ? "border-indigo-400 bg-indigo-950/40"
            : showAmbientEligible
              ? "border-indigo-700 bg-indigo-950/10"
              : "border-slate-700 bg-slate-800"
      }`}
    >
      {showDropHighlight && (
        // Live preview of the start time this band would get if dropped
        // here right now. The slot's own startTime is already correct for
        // this regardless of which band ends up in it — a slot's start is
        // only a function of everything BEFORE it, never of its own
        // occupant — so no separate what-if calculation is needed, just
        // surfacing the value that's already computed.
        <div className="pointer-events-none absolute -top-2 right-2 z-10 rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-md shadow-black/40">
          → {slot.startTime} 開始
        </div>
      )}
      <button
        ref={setActivatorNodeRef}
        {...listeners}
        {...attributes}
        className="flex w-4 shrink-0 cursor-grab items-center justify-center text-xs text-slate-500 hover:text-slate-300 active:cursor-grabbing"
        title="ドラッグして順番を入れ替え"
      >
        ⠿
      </button>

      {performanceOrder !== null && (
        <div className="flex w-5 shrink-0 items-center justify-center">
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold leading-none text-white"
            title={`出演順 ${performanceOrder}番目`}
          >
            {performanceOrder}
          </span>
        </div>
      )}

      <div className="flex w-16 shrink-0 flex-col justify-center font-mono text-xs text-slate-300">
        <span>{slot.startTime}</span>
        <span className="text-slate-500">-{slot.endTime}</span>
      </div>

      {isCustom ? (
        <div className="flex flex-1 items-center gap-1.5 rounded-md border border-amber-600 bg-amber-900/40 px-1.5 py-1">
          <input
            className="flex-1 bg-transparent text-sm font-semibold text-amber-300 outline-none"
            value={slot.customLabel ?? ""}
            onChange={(e) =>
              updateSlotContent(dayId, slot.id, { customLabel: e.target.value })
            }
          />
          <input
            type="number"
            min={1}
            className="w-14 bg-transparent text-right text-xs text-amber-400 outline-none"
            value={slot.customDurationMinutes ?? ""}
            onChange={(e) =>
              updateSlotContent(dayId, slot.id, {
                customDurationMinutes: e.target.value
                  ? Number(e.target.value)
                  : null,
              })
            }
          />
          <span className="text-xs text-amber-500">分</span>
        </div>
      ) : (
        <div
          ref={bandDraggable.setNodeRef}
          className={`flex min-h-[36px] flex-1 items-center rounded-md border px-1.5 py-1 ${
            band
              ? "border-slate-700 bg-slate-900"
              : showAmbientEligible || showDropHighlight
                ? "border-dashed border-indigo-500 text-xs text-indigo-300"
                : "border-dashed border-slate-700 text-xs text-slate-500"
          } ${conflict ? "border-rose-500 bg-rose-950/40" : ""} ${
            bandDraggable.isDragging ? "opacity-50" : ""
          }`}
        >
          {band ? (
            <div
              {...bandDraggable.listeners}
              {...bandDraggable.attributes}
              className="w-full cursor-grab active:cursor-grabbing"
            >
              <p className="text-sm font-semibold text-slate-100">
                {band.name}
                {band.durationMinutes != null && (
                  <span className="ml-1.5 text-xs font-normal text-indigo-400">
                    ({band.durationMinutes}分)
                  </span>
                )}
                {band.hasSync && (
                  <span
                    className="ml-1 rounded border border-violet-500 bg-violet-950/50 px-1 text-xs font-normal text-violet-300"
                    title="同期演奏あり"
                  >
                    🔌
                  </span>
                )}
                {band.hasKeyboard && (
                  <span
                    className="ml-1 rounded border border-sky-500 bg-sky-950/50 px-1 text-xs font-normal text-sky-300"
                    title="キーボードあり"
                  >
                    🎹
                  </span>
                )}
                {band.setlist.length > 0 && (
                  <span className="relative ml-1 inline-block">
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => setShowSetlist((v) => !v)}
                      onMouseEnter={() => setShowSetlist(true)}
                      onMouseLeave={() => setShowSetlist(false)}
                      className="rounded border border-emerald-500 bg-emerald-950/50 px-1 text-xs font-normal text-emerald-300"
                      title="演奏予定曲（クリックまたはホバーで表示）"
                    >
                      🎵
                    </button>
                    {showSetlist && (
                      // pointer-events-none so this read-only popup can
                      // never intercept clicks/hover on neighboring slots
                      // or drag targets underneath it — it's purely a
                      // glance-and-go tooltip, nothing inside needs to be
                      // clickable.
                      <div className="pointer-events-none absolute left-0 top-full z-50 mt-1 w-48 rounded-lg border border-slate-700 bg-slate-800 p-2 text-left shadow-lg shadow-black/50">
                        <p className="mb-0.5 text-xs font-semibold text-slate-400">
                          🎵 セットリスト
                        </p>
                        <ul className="space-y-0.5 text-xs font-normal text-slate-200">
                          {band.setlist.map((song, i) => (
                            <li key={i} className="truncate">
                              {song}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </span>
                )}
                {band.customTransitionMinutes != null && (
                  <span
                    className="ml-1 rounded border border-cyan-500 bg-cyan-950/50 px-1 text-xs font-normal text-cyan-300"
                    title="この後の転換時間（個別設定）"
                  >
                    ⏱+{band.customTransitionMinutes}分
                  </span>
                )}
              </p>
              <p className="truncate text-xs text-slate-400">
                {band.members.join(", ")}
              </p>
              {conflict && (
                <p className="text-xs font-medium text-rose-400">
                  ⚠ 前後の枠とメンバーが重複
                </p>
              )}
            </div>
          ) : (
            <span>
              {isDraggingBand && !isBlockedForDraggedBand
                ? "ここにドロップ"
                : "ここにバンドをドラッグ"}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-col justify-center gap-0.5">
        <button
          onClick={() => moveSlot(dayId, slot.id, "up")}
          disabled={index === 0}
          className="px-1 text-xs text-slate-500 hover:text-slate-300 disabled:opacity-20"
          title="上に移動"
        >
          ▲
        </button>
        <button
          onClick={() => moveSlot(dayId, slot.id, "down")}
          disabled={index === total - 1}
          className="px-1 text-xs text-slate-500 hover:text-slate-300 disabled:opacity-20"
          title="下に移動"
        >
          ▼
        </button>
      </div>
      <button
        onClick={() => removeSlot(dayId, slot.id)}
        className="flex h-6 w-6 shrink-0 items-center justify-center self-center rounded-full text-base leading-none text-slate-500 hover:bg-rose-950/60 hover:text-rose-400 active:bg-rose-900/70"
        title="枠を削除"
      >
        ×
      </button>
    </div>
  );
}
