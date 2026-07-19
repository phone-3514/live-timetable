import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { ModalPortal } from "./ModalPortal";
import type { TimetableSlot } from "../types";

type Props = { dayId: string; slot: TimetableSlot; onClose: () => void };

// Mobile-only editing surface for a Rehearsal/Break ("custom") slot's
// name and duration — replaces the inline `<input>` MobileSlotCard used
// to render directly in the condensed row. That input was directly
// editable/focusable, which meant a long-press meant to start a drag was
// instead captured by the browser's native text-selection/caret UI the
// instant the input gained focus, before dnd-kit's TouchSensor delay
// ever got a chance to decide "this is a drag." Moving editing into an
// explicit modal (opened by a quick tap, not focus) frees the row itself
// to be `select-none` and fully long-press-draggable, matching how band
// cards already behave. Desktop's DayPanel/SlotCard inline editing is a
// completely separate code path and is untouched by this.
export function MobileCustomSlotModal({ dayId, slot, onClose }: Props) {
  useEscapeKey(onClose);
  useBodyScrollLock();
  const updateSlotContent = useAppStore((s) => s.updateSlotContent);
  const [label, setLabel] = useState(slot.customLabel ?? "");
  const [minutes, setMinutes] = useState(slot.customDurationMinutes ?? 10);

  const handleSave = () => {
    updateSlotContent(dayId, slot.id, {
      customLabel: label.trim() || slot.customLabel,
      customDurationMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : slot.customDurationMinutes,
    });
    onClose();
  };

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="枠を編集"
        className="w-full max-w-sm rounded-t-2xl border-t border-slate-700 bg-slate-900 p-4 pb-6 sm:rounded-2xl sm:border"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold text-slate-100">枠を編集</h2>
        <label className="mb-3 flex flex-col gap-1 text-xs text-slate-400">
          名前
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
            autoFocus
            className="min-h-11 rounded border border-slate-600 bg-slate-800 px-3 text-sm text-slate-100 outline-none focus:border-indigo-500"
          />
        </label>
        <label className="mb-4 flex flex-col gap-1 text-xs text-slate-400">
          所要時間（分）
          <input
            type="number"
            min={1}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="min-h-11 w-24 rounded border border-slate-600 bg-slate-800 px-3 text-sm text-slate-100 outline-none focus:border-indigo-500"
          />
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 flex-1 rounded-md border border-slate-600 text-sm text-slate-300"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="min-h-11 flex-1 rounded-md bg-indigo-600 text-sm font-semibold text-white active:bg-indigo-500"
          >
            保存
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
