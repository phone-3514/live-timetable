import { useDndContext, useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAppStore } from "../store/useAppStore";
import type { Band, TimetableSlot } from "../types";

type Props = {
  dayId: string;
  slot: TimetableSlot;
  band: Band | undefined;
  index: number;
  total: number;
  conflict: boolean;
};

export function SlotCard({ dayId, slot, band, index, total, conflict }: Props) {
  const moveSlot = useAppStore((s) => s.moveSlot);
  const removeSlot = useAppStore((s) => s.removeSlot);
  const updateSlotContent = useAppStore((s) => s.updateSlotContent);

  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: slot.id });

  const bandDraggable = useDraggable({
    id: band ? `band:${band.id}` : `empty-band:${slot.id}`,
    disabled: !band,
  });

  const { active } = useDndContext();
  const isDraggingBand =
    typeof active?.id === "string" && active.id.startsWith("band:");

  const isCustom = slot.customLabel !== null;
  const showDropHighlight = isOver && !(isCustom && isDraggingBand);

  const rowStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={rowStyle}
      className={`flex items-stretch gap-2 rounded-lg border p-2 ${
        isDragging ? "opacity-40" : ""
      } ${showDropHighlight ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-white"}`}
    >
      <button
        ref={setActivatorNodeRef}
        {...listeners}
        {...attributes}
        className="flex w-6 shrink-0 cursor-grab items-center justify-center text-slate-300 hover:text-slate-500 active:cursor-grabbing"
        title="ドラッグして順番を入れ替え"
      >
        ⠿
      </button>

      <div className="flex w-24 shrink-0 flex-col justify-center font-mono text-sm text-slate-600">
        <span>{slot.startTime}</span>
        <span className="text-slate-300">-{slot.endTime}</span>
      </div>

      {isCustom ? (
        <div className="flex flex-1 items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-2">
          <input
            className="flex-1 bg-transparent font-semibold text-amber-800 outline-none"
            value={slot.customLabel ?? ""}
            onChange={(e) =>
              updateSlotContent(dayId, slot.id, { customLabel: e.target.value })
            }
          />
          <input
            type="number"
            min={1}
            className="w-16 bg-transparent text-right text-sm text-amber-700 outline-none"
            value={slot.customDurationMinutes ?? ""}
            onChange={(e) =>
              updateSlotContent(dayId, slot.id, {
                customDurationMinutes: e.target.value
                  ? Number(e.target.value)
                  : null,
              })
            }
          />
          <span className="text-xs text-amber-600">分</span>
        </div>
      ) : (
        <div
          ref={bandDraggable.setNodeRef}
          style={
            bandDraggable.transform
              ? {
                  transform: `translate3d(${bandDraggable.transform.x}px, ${bandDraggable.transform.y}px, 0)`,
                }
              : undefined
          }
          className={`flex min-h-[56px] flex-1 items-center rounded-md border p-2 ${
            band
              ? "border-slate-200 bg-slate-50"
              : "border-dashed border-slate-200 text-sm text-slate-300"
          } ${conflict ? "border-rose-400 bg-rose-50" : ""} ${
            bandDraggable.isDragging ? "opacity-50" : ""
          }`}
        >
          {band ? (
            <div
              {...bandDraggable.listeners}
              {...bandDraggable.attributes}
              className="w-full cursor-grab active:cursor-grabbing"
            >
              <p className="font-semibold text-slate-800">
                {band.name}
                {band.durationMinutes != null && (
                  <span className="ml-2 text-xs font-normal text-indigo-500">
                    ({band.durationMinutes}分)
                  </span>
                )}
              </p>
              <p className="text-xs text-slate-500">
                {band.members.join(", ")}
              </p>
              {conflict && (
                <p className="mt-1 text-xs font-medium text-rose-600">
                  ⚠ 前後の枠とメンバーが重複しています
                </p>
              )}
            </div>
          ) : (
            <span>ここにバンドをドラッグ</span>
          )}
        </div>
      )}

      <div className="flex flex-col justify-center gap-1">
        <button
          onClick={() => moveSlot(dayId, slot.id, "up")}
          disabled={index === 0}
          className="px-1 text-xs text-slate-400 hover:text-slate-700 disabled:opacity-20"
          title="上に移動"
        >
          ▲
        </button>
        <button
          onClick={() => moveSlot(dayId, slot.id, "down")}
          disabled={index === total - 1}
          className="px-1 text-xs text-slate-400 hover:text-slate-700 disabled:opacity-20"
          title="下に移動"
        >
          ▼
        </button>
      </div>
      <button
        onClick={() => removeSlot(dayId, slot.id)}
        className="self-center text-sm text-slate-300 hover:text-rose-500"
        title="枠を削除"
      >
        ×
      </button>
    </div>
  );
}
