import { useState } from "react";
import { useDndContext, useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  canPlaceBandInSlot,
  computeDropPreviewStartTime,
  useAppStore,
} from "../store/useAppStore";
import type { MemberConflictEntry } from "../store/useAppStore";
import type { Band, TimetableSlot } from "../types";
import { PlacedBandDetailModal } from "./PlacedBandDetailModal";

type Props = {
  dayId: string;
  slot: TimetableSlot;
  band: Band | undefined;
  index: number;
  total: number;
  /** Members whose own performances conflict with this slot's band, each
   * tagged with why — "gap" (back-to-back/overlapping, <= 0 minutes) or
   * "same-band" (their next performance is the identical band, regardless
   * of the transition gap). Empty when there's no conflict. See
   * getMemberConflictDetails. */
  conflicts: MemberConflictEntry[];
  gearConflict: boolean;
  /** Members whose performances that day are 2+ in count and 100%
   * concentrated in this slot's block (the stretch between breaks/custom
   * slots — see getConcentrationWarningDetails). A milder, separate signal
   * from `conflicts`: not "these two performances literally clash," but
   * "this person never gets a real break." Can coexist with a conflict on
   * the same slot. */
  concentrationMemberNames: string[];
  performanceOrder: number | null;
};

export function SlotCard({
  dayId,
  slot,
  band,
  index,
  total,
  conflicts,
  gearConflict,
  concentrationMemberNames,
  performanceOrder,
}: Props) {
  const conflict = conflicts.length > 0;
  const sameBandConflictNames = conflicts
    .filter((c) => c.reason === "same-band")
    .map((c) => c.memberName);
  const gapConflictNames = conflicts
    .filter((c) => c.reason === "gap")
    .map((c) => c.memberName);
  const hasConcentrationWarning = concentrationMemberNames.length > 0;
  const [showSetlist, setShowSetlist] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
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
  const previewStartTime =
    isOver && isDraggingBand && draggedBandId && day && !isBlockedForDraggedBand
      ? computeDropPreviewStartTime(day, draggedBandId, slot.id, bands)
      : null;

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
      {previewStartTime !== null && (
        // Live preview of the start time this band would get if dropped
        // here right now, computed as-if the dragged band's own origin slot
        // (if it has one) were already vacated — see
        // computeDropPreviewStartTime for why that matters.
        <div className="pointer-events-none absolute -top-2 right-2 z-10 rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-md shadow-black/40">
          → {previewStartTime} 開始予定
        </div>
      )}
      {showDropHighlight && band && draggedBandId !== band.id && (
        // "Magnetic" insert cue — dropping here won't replace this band,
        // it'll open a new slot in front of it and push this one (and
        // everyone after it that day) later. See insertBandAtSlot.
        <div className="pointer-events-none absolute -top-2 left-2 z-10 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-md shadow-black/40">
          ⬇ ここに挿入（後ろへずれます）
        </div>
      )}
      <button
        ref={setActivatorNodeRef}
        {...listeners}
        {...attributes}
        // touch-none stops the browser from treating a touch-drag here as a
        // page/list scroll gesture instead of handing it to dnd-kit — the
        // standard fix for "drag and drop doesn't work on mobile" with
        // PointerSensor (the default sensor, already touch-capable via the
        // Pointer Events API once this is set).
        className="flex min-h-11 w-8 shrink-0 touch-none cursor-grab items-center justify-center text-base text-slate-500 hover:text-slate-300 active:cursor-grabbing md:min-h-0 md:w-4 md:text-xs"
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
          {/* +/- stepper buttons instead of relying on the number input's
              tiny native spin arrows — easier to tap, and the input itself
              gets a visible border/background so it reads as editable
              rather than floating text. */}
          <div className="flex shrink-0 items-center overflow-hidden rounded border border-amber-600/60 bg-amber-950/50">
            <button
              onClick={() =>
                updateSlotContent(dayId, slot.id, {
                  customDurationMinutes: Math.max(
                    1,
                    (slot.customDurationMinutes ?? 1) - 5,
                  ),
                })
              }
              className="px-1.5 py-1 text-sm font-bold text-amber-300 hover:bg-amber-800/60"
              title="5分減らす"
            >
              −
            </button>
            <input
              type="number"
              min={1}
              className="w-10 bg-transparent text-center text-sm font-semibold text-amber-100 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              value={slot.customDurationMinutes ?? ""}
              onChange={(e) =>
                updateSlotContent(dayId, slot.id, {
                  customDurationMinutes: e.target.value
                    ? Number(e.target.value)
                    : null,
                })
              }
            />
            <button
              onClick={() =>
                updateSlotContent(dayId, slot.id, {
                  customDurationMinutes: (slot.customDurationMinutes ?? 0) + 5,
                })
              }
              className="px-1.5 py-1 text-sm font-bold text-amber-300 hover:bg-amber-800/60"
              title="5分増やす"
            >
              ＋
            </button>
          </div>
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
          } ${
            conflict
              ? "border-rose-500 bg-rose-950/40"
              : gearConflict
                ? "border-amber-500 bg-amber-950/30"
                : hasConcentrationWarning
                  ? "border-violet-500 bg-violet-950/30"
                  : ""
          } ${
            bandDraggable.isDragging ? "opacity-50" : ""
          }`}
        >
          {band ? (
            <div
              {...bandDraggable.listeners}
              {...bandDraggable.attributes}
              className="w-full min-h-11 cursor-grab touch-none active:cursor-grabbing md:min-h-0"
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
              {sameBandConflictNames.length > 0 && (
                <p className="text-xs font-medium text-rose-400">
                  ⚠️ {sameBandConflictNames.join("、")} が同じバンドで連続出演しています
                </p>
              )}
              {gapConflictNames.length > 0 && (
                <p className="text-xs font-medium text-rose-400">
                  ⚠️ {gapConflictNames.join("、")} が連続しています
                </p>
              )}
              {!conflict && gearConflict && (
                <p className="text-xs font-medium text-amber-400">
                  ⚙ 前後の枠と共有機材が重複
                </p>
              )}
              {hasConcentrationWarning && (
                <p className="text-xs font-medium text-violet-400">
                  ⚠️ {concentrationMemberNames.join("、")} の出番が集中しています
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

      <div className="flex flex-col justify-center gap-1">
        <button
          onClick={() => moveSlot(dayId, slot.id, "up")}
          disabled={index === 0}
          className="flex min-h-9 min-w-9 items-center justify-center px-1 text-xs text-slate-500 hover:text-slate-300 disabled:opacity-20 md:min-h-0 md:min-w-0"
          title="上に移動"
        >
          ▲
        </button>
        <button
          onClick={() => moveSlot(dayId, slot.id, "down")}
          disabled={index === total - 1}
          className="flex min-h-9 min-w-9 items-center justify-center px-1 text-xs text-slate-500 hover:text-slate-300 disabled:opacity-20 md:min-h-0 md:min-w-0"
          title="下に移動"
        >
          ▼
        </button>
      </div>
      {band && (
        // Deliberately kept at a full 44x44px touch target on every
        // breakpoint (unlike the move/delete buttons above, which shrink on
        // desktop) — this is the one control on a placed band's card meant
        // to be reachable without any precision, on mobile or desktop
        // alike. It sits outside the bandDraggable-wrapped div above, so it
        // was never going to pick up drag listeners by accident anyway;
        // stopPropagation on both handlers is still added defensively so
        // that stays true even if the drag wiring ever moves.
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setShowDetails(true);
          }}
          className="flex h-11 w-11 shrink-0 items-center justify-center self-center rounded-full text-lg leading-none text-slate-400 hover:bg-slate-700 hover:text-slate-100 active:bg-slate-600"
          title="バンドの詳細を表示"
        >
          ⋮
        </button>
      )}
      <button
        onClick={() => removeSlot(dayId, slot.id)}
        className="flex h-11 w-11 shrink-0 items-center justify-center self-center rounded-full text-base leading-none text-slate-500 hover:bg-rose-950/60 hover:text-rose-400 active:bg-rose-900/70 md:h-6 md:w-6"
        title="枠を削除"
      >
        ×
      </button>
      {band && showDetails && (
        <PlacedBandDetailModal band={band} slot={slot} onClose={() => setShowDetails(false)} />
      )}
    </div>
  );
}
