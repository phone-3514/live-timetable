import { useState } from "react";
import { useDndContext } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { canPlaceBandInSlot, useAppStore } from "../store/useAppStore";
import type { ConcentrationEntry, MemberConflictEntry } from "../store/useAppStore";
import { useHoveringUsers, useLockedBandOwner } from "../store/useCollabStore";
import type { Band, TimetableSlot } from "../types";
import { PlacedBandDetailModal } from "./PlacedBandDetailModal";
import { MobileCustomSlotModal } from "./MobileCustomSlotModal";

// See SlotCard.tsx's identical type — same reasoning: `active.data.current`
// replaces `active.id.startsWith("band:")` string-parsing now that an
// already-placed band's drag shares the row's own sortable id instead of
// a separate band-prefixed one (see below).
type ActiveDragPayload = { type: "slot"; slot: TimetableSlot; band?: Band } | { type: "band"; band: Band };

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
  const [showCustomEdit, setShowCustomEdit] = useState(false);
  const removeSlot = useAppStore((s) => s.removeSlot);
  const day = useAppStore((s) => s.days.find((d) => d.id === dayId));
  const venueHours = useAppStore((s) => s.venueHours);

  // Computed before useSortable below since it now feeds that hook's own
  // `disabled` option — see SlotCard.tsx's identical comment.
  const lockedByNickname = useLockedBandOwner(band?.id);

  // One shared sortable session for the whole row — the ⠿ handle AND the
  // band-content div further down are both activators for this SAME
  // session now, not a separate useDraggable for the band. That's what
  // makes SortableContext compute a real sibling-shift transform during a
  // full-cell/long-press drag instead of only during a handle drag — see
  // SlotCard.tsx's fuller comment on this (verified by comparing a
  // neighboring row's computed `transform` mid-drag between the two).
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging, isOver } =
    useSortable({ id: slot.id, data: { type: "slot", slot, band }, disabled: lockedByNickname !== null });

  // Keyed by slot.id, not band.id — a Rehearsal/Break custom slot (or
  // even an empty one) has no band to key off, but every slot has an id,
  // and that's what SlotCard's desktop-side onMouseEnter/onMouseLeave
  // broadcasts (see useCollabStore.ts). Works identically for all three
  // slot kinds this row can render below.
  const hoveringUsers = useHoveringUsers(slot.id);

  const { active } = useDndContext();
  const activePayload = active?.data.current as ActiveDragPayload | undefined;
  const draggedBand = activePayload?.band;
  const draggedBandId = draggedBand ? draggedBand.id : null;
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
      // See SlotCard.tsx's identical comment: select-none/
      // -webkit-touch-callout/-webkit-user-drag inherit down to every
      // child from here, and touch-action's effective value is the
      // intersection with ancestors — no need to repeat these on the ⠿
      // handle or the band-content/custom-content divs. touch-pan-y (not
      // touch-action: none) keeps this row scrollable by a normal swipe
      // that doesn't hold long enough to activate the 500ms TouchSensor
      // delay.
      className={`flex w-full min-w-0 touch-pan-y select-none items-center gap-1 rounded-md border p-1 shadow-[0_2px_6px_rgba(0,0,0,0.06)] transition-transform [-webkit-touch-callout:none] [-webkit-user-drag:none] ${
        isDragging ? "scale-[1.03] opacity-40" : ""
      } ${
        showBlockedHighlight
          ? "border-rose-500 bg-rose-950/40"
          : showDropHighlight
            ? "border-indigo-400 bg-indigo-950/40"
            : // A desktop collaborator hovering this exact slot — band,
              // Rehearsal/Break, or empty — highlights the whole row's
              // border, on top of the small 👀 name tag near the buttons
              // below. Takes priority over the plain amber "this is a
              // custom slot" tint so live presence is never invisible
              // just because the row happens to be a Rehearsal/Break.
              hoveringUsers.length > 0
              ? "border-sky-400 bg-sky-950/20"
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
        <div
          {...listeners}
          {...attributes}
          onClick={() => setShowCustomEdit(true)}
          // select-none (+ the same drag `listeners`/`attributes` the ⠿
          // handle uses) is what fixes the actual reported bug: this used
          // to be a live `<input>`, and long-pressing a text input is
          // captured by the browser's native text-selection/caret UI
          // before dnd-kit's TouchSensor delay ever gets to decide
          // "that's a drag." A plain non-editable, non-selectable div
          // sharing the row's own drag session behaves exactly like a
          // band card's content area: a quick tap opens the edit modal
          // below (dnd-kit never activated, so the click fires normally),
          // a held long-press drags the whole slot.
          className="flex min-w-0 flex-1 cursor-grab select-none items-center gap-1.5 active:cursor-grabbing"
        >
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-amber-300">
            {slot.customLabel}
          </span>
          <span className="shrink-0 text-[10px] text-amber-500">{slot.customDurationMinutes ?? 0}分</span>
        </div>
      ) : band ? (
        <div
          id={`band-slot-${band.id}`}
          // Same shared sortable session as the ⠿ handle — see the
          // module-level comment and SlotCard.tsx's fuller one. isDragging
          // is intentionally not re-applied here; the outer row already
          // scales/dims for the whole card.
          {...listeners}
          {...attributes}
          className={`flex min-h-8 min-w-0 flex-1 items-center gap-1 ${
            lockedByNickname ? "opacity-70" : "cursor-grab active:cursor-grabbing"
          }`}
        >
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-100">{band.name}</span>
          {lockedByNickname && (
            <span className="shrink-0 text-xs" title={`${lockedByNickname}が移動中`}>
              🔒
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

      {/* Live presence tag — "who's looking at this," universal across
          band/Rehearsal/Break/empty (see hoveringUsers above, keyed by
          slot.id). Placed outside the band/custom/empty branches so it
          renders identically regardless of which one this row is,
          rather than being duplicated inside each. Disappears the
          instant the desktop collaborator's mouse leaves the card —
          see SlotCard.tsx's onMouseLeave, no extra logic needed here. */}
      {hoveringUsers.length > 0 && (
        <span
          className="inline-block max-w-[5.5rem] shrink-0 truncate whitespace-nowrap rounded border border-sky-400 bg-sky-950/70 px-1 text-[10px] font-medium text-sky-300"
          title={`${hoveringUsers.join("、")}が見ています`}
        >
          👀 {hoveringUsers[0]}
          {hoveringUsers.length > 1 && `+${hoveringUsers.length - 1}`}
        </span>
      )}

      {band && (
        // The actual clickable box is a full 44x44px (accessibility
        // minimum) via `h-11 w-11`, but `-m-1.5` (-6px each side) pulls
        // that box back in by exactly the amount it grew, so its
        // contribution to the row's flex layout stays the original
        // 32x32 footprint — the invisible hit area overlaps its
        // neighbors instead of pushing them and widening the row. Only
        // the small inner span is actually painted, so visually nothing
        // about the condensed layout changes.
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setShowDetails(true);
          }}
          className="relative -m-1.5 flex h-11 w-11 shrink-0 items-center justify-center"
          title="詳細を表示"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-sm font-bold leading-none text-slate-300 active:bg-slate-600">
            ›
          </span>
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
      {isCustom && showCustomEdit && (
        <MobileCustomSlotModal dayId={dayId} slot={slot} onClose={() => setShowCustomEdit(false)} />
      )}
    </div>
  );
}
