import { useState } from "react";
import { useDndContext, useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { canPlaceBandInSlot, useAppStore } from "../store/useAppStore";
import type { ConcentrationEntry, MemberConflictEntry } from "../store/useAppStore";
import { useCollabStore, useHoveringUsers, useLockedBandOwner } from "../store/useCollabStore";
import type { Band, TimetableSlot } from "../types";
import { PlacedBandDetailModal } from "./PlacedBandDetailModal";

type Props = {
  dayId: string;
  slot: TimetableSlot;
  band: Band | undefined;
  conflicts: MemberConflictEntry[];
  gearConflict: boolean;
  concentrationEntries: ConcentrationEntry[];
  performanceOrder: number | null;
};

// The mobile-only condensed row: one line, strictly `min-w-0`/`truncate`
// throughout so nothing here can ever force horizontal scroll no matter
// how long a band name is. Member names, parts, grades, and the setlist
// — everything SlotCard shows across 2-4 extra lines — live behind the
// "詳細" button instead (PlacedBandDetailModal, the same edit surface
// desktop uses — reused rather than built twice). Conflict/lock/hover
// awareness stays as single icons inline, since knowing *something*
// needs attention is worth a few px even in an "extreme condensation"
// pass; what SPECIFIC members are involved is a 詳細 tap away.
//
// Drag wiring is intentionally identical to SlotCard's, not a lighter
// re-implementation: `useSortable({id: slot.id, ...})` for slot reorder
// (Rehearsal/Break slots included — this hook was never conditioned on
// `band` existing, so a custom slot drags exactly the same way a band
// slot does, same long-press activation from App.tsx's TouchSensor, same
// scale/opacity feedback, same haptic ping on activation) and a nested
// `useDraggable` for the band itself when one is placed here. The ▲/▼
// reorder buttons SlotCard also offers are dropped from this row on
// purpose — with long-press drag confirmed working reliably (see the
// mobile-responsive memory's long-press round), keeping a second control
// that does the same thing just to be a fallback cost more width than
// this pass's "strictly fit within 100vw" goal could spare.
export function MobileSlotCard({
  dayId,
  slot,
  band,
  conflicts,
  gearConflict,
  concentrationEntries,
  performanceOrder,
}: Props) {
  const hasWarning = conflicts.length > 0 || gearConflict || concentrationEntries.length > 0;
  const warningTitle = [
    ...conflicts.map((c) =>
      c.reason === "same-band"
        ? `${c.memberName}が同じバンドで連続出演`
        : `${c.memberName}が連続しています`,
    ),
    ...(gearConflict ? ["前後の枠と共有機材が重複"] : []),
    ...concentrationEntries.map((c) => `${c.memberName}の出演が集中しています`),
  ].join("、");

  const [showDetails, setShowDetails] = useState(false);
  const removeSlot = useAppStore((s) => s.removeSlot);
  const updateSlotContent = useAppStore((s) => s.updateSlotContent);
  const day = useAppStore((s) => s.days.find((d) => d.id === dayId));
  const bands = useAppStore((s) => s.bands);
  const venueHours = useAppStore((s) => s.venueHours);

  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging, isOver } =
    useSortable({ id: slot.id, data: { type: "slot", slot, band } });

  const lockedByNickname = useLockedBandOwner(band?.id);
  const bandDraggable = useDraggable({
    id: band ? `band:${band.id}` : `empty-band:${slot.id}`,
    disabled: !band || lockedByNickname !== null,
    data: band ? { type: "band", band } : undefined,
  });
  const hoveringUsers = useHoveringUsers(band?.id);

  const { active } = useDndContext();
  const draggedBandId =
    typeof active?.id === "string" && active.id.startsWith("band:") ? active.id.slice("band:".length) : null;
  const draggedBand = draggedBandId ? bands.find((b) => b.id === draggedBandId) : undefined;
  const isDraggingBand = draggedBandId !== null;
  const isBlockedForDraggedBand =
    isDraggingBand && day && draggedBand ? !canPlaceBandInSlot(draggedBand, day, slot, venueHours) : false;
  const isCustom = slot.customLabel !== null;
  const showDropHighlight = isOver && !isBlockedForDraggedBand;
  const showBlockedHighlight = isOver && isBlockedForDraggedBand;

  const rowStyle = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={rowStyle}
      className={`flex w-full min-w-0 items-center gap-1 rounded-md border p-1 transition-transform ${
        isDragging ? "scale-[1.03] opacity-40" : ""
      } ${
        showBlockedHighlight
          ? "border-rose-500 bg-rose-950/40"
          : showDropHighlight
            ? "border-indigo-400 bg-indigo-950/40"
            : isCustom
              ? "border-amber-700 bg-amber-950/20"
              : "border-slate-700 bg-slate-800"
      }`}
    >
      <button
        ref={setActivatorNodeRef}
        {...listeners}
        {...attributes}
        // No touch-action: none — see App.tsx's TouchSensor comment; the
        // long-press delay is what keeps this safe for a normal scroll
        // gesture starting here.
        className="flex h-8 w-6 shrink-0 items-center justify-center text-sm text-slate-500 active:cursor-grabbing"
        title="長押しで順番を入れ替え"
      >
        ⠿
      </button>

      {performanceOrder !== null && (
        <span
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[9px] font-bold leading-none text-white"
          title={`出演順 ${performanceOrder}番目`}
        >
          {performanceOrder}
        </span>
      )}

      <span className="w-9 shrink-0 font-mono text-[10px] text-slate-400">{slot.startTime}</span>

      {isCustom ? (
        <>
          <input
            value={slot.customLabel ?? ""}
            onChange={(e) => updateSlotContent(dayId, slot.id, { customLabel: e.target.value })}
            className="min-w-0 flex-1 truncate bg-transparent text-xs font-semibold text-amber-300 outline-none"
          />
          <span className="shrink-0 text-[10px] text-amber-500">{slot.customDurationMinutes ?? 0}分</span>
        </>
      ) : band ? (
        <div
          ref={bandDraggable.setNodeRef}
          id={`band-slot-${band.id}`}
          {...bandDraggable.listeners}
          {...bandDraggable.attributes}
          onMouseEnter={() => useCollabStore.getState().setMyHoveredElementId(band.id)}
          onMouseLeave={() => useCollabStore.getState().setMyHoveredElementId(null)}
          className={`flex min-h-8 min-w-0 flex-1 items-center gap-1 transition-transform ${
            lockedByNickname ? "opacity-70" : "cursor-grab active:cursor-grabbing"
          } ${bandDraggable.isDragging ? "scale-[1.03]" : ""}`}
        >
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-100">{band.name}</span>
          {lockedByNickname && (
            <span className="shrink-0 text-xs" title={`${lockedByNickname}が移動中`}>
              🔒
            </span>
          )}
          {hoveringUsers.length > 0 && (
            <span className="shrink-0 text-xs" title={`${hoveringUsers.join("、")}が見ています`}>
              👀
            </span>
          )}
          {hasWarning && (
            <span className="shrink-0 text-xs" title={warningTitle}>
              ⚠️
            </span>
          )}
        </div>
      ) : (
        <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
          {isDraggingBand && !isBlockedForDraggedBand ? "ここにドロップ" : "空き枠"}
        </span>
      )}

      {band && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setShowDetails(true);
          }}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm text-slate-400 active:bg-slate-700"
          title="詳細を表示"
        >
          ℹ️
        </button>
      )}
      <button
        onClick={() => removeSlot(dayId, slot.id)}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm text-slate-500 active:bg-rose-900/70"
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
