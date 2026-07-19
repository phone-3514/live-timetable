import { useState } from "react";
import { useDndContext } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  canPlaceBandInSlot,
  computeDropPreviewStartTime,
  formatConcentrationMessage,
  useAppStore,
} from "../store/useAppStore";
import type { ConcentrationEntry, MemberConflictEntry } from "../store/useAppStore";
import { useCollabStore, useLockedBandOwner } from "../store/useCollabStore";
import type { Band, TimetableSlot } from "../types";
import { PlacedBandDetailModal } from "./PlacedBandDetailModal";

// What `active.data.current` holds during a drag, from whichever of the
// two activators started it: this row's own useSortable session
// (id: slot.id — the ⠿ handle AND, as of this fix, the band-content area
// too, see below) or BandChip's separate useDraggable (id: `band:<id>`,
// for a genuinely unplaced band with no origin slot to be sortable
// about). Reading `.band` off either shape is what replaced the old
// `active.id.startsWith("band:")` string-parsing below — that scheme
// stopped being able to tell "a band is being dragged" once the
// band-content area started sharing the slot's own sortable id instead
// of its own band-prefixed one.
type ActiveDragPayload = { type: "slot"; slot: TimetableSlot; band?: Band } | { type: "band"; band: Band };

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
  /** Members whose performances that day are 2+ in count and mostly or
   * entirely concentrated in this slot's block (the stretch between
   * breaks/custom slots — see getConcentrationWarningDetails), each tagged
   * "full" (100%) or "partial" (majority) with the underlying counts. A
   * milder, separate signal from `conflicts`: not "these two performances
   * literally clash," but "this person barely gets a real break." Can
   * coexist with a conflict on the same slot. */
  concentrationEntries: ConcentrationEntry[];
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
  concentrationEntries,
  performanceOrder,
}: Props) {
  const conflict = conflicts.length > 0;
  const sameBandConflictNames = conflicts
    .filter((c) => c.reason === "same-band")
    .map((c) => c.memberName);
  const gapConflictNames = conflicts
    .filter((c) => c.reason === "gap")
    .map((c) => c.memberName);
  const hasConcentrationWarning = concentrationEntries.length > 0;
  const hasFullConcentration = concentrationEntries.some((c) => c.level === "full");
  const [showSetlist, setShowSetlist] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  // Custom-slot (休憩/リハーサル/etc.) label editing — a click-to-edit
  // toggle, NOT an always-live <input>. A mousedown that lands directly
  // on a native <input> is captured by the browser's own default
  // behavior (focus + text-cursor placement) before dnd-kit's MouseSensor
  // ever gets a chance to see it as the start of a drag — confirmed
  // directly (a real Playwright mouse-drag from the input selected text
  // instead of reordering the row). A band row never had this problem
  // because a band's name is plain text, never an editable field, so
  // clicking anywhere on it always drags. Defaulting to plain draggable
  // text here (switching to the input only once explicitly clicked into)
  // gives custom slots the same "click anywhere on the row to drag"
  // parity band rows already had, matching MobileCustomSlotModal's
  // identical reasoning for the same bug on the mobile side.
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const moveSlot = useAppStore((s) => s.moveSlot);
  const removeSlot = useAppStore((s) => s.removeSlot);
  const updateSlotContent = useAppStore((s) => s.updateSlotContent);
  const day = useAppStore((s) => s.days.find((d) => d.id === dayId));
  const bands = useAppStore((s) => s.bands);
  const venueHours = useAppStore((s) => s.venueHours);

  // Another collaborator's nickname if THEY currently have this exact
  // band picked up (see useCollabStore/useLivePresence) — null the vast
  // majority of the time (not in a collab room, or nobody else is
  // dragging this specific band), in which case this behaves exactly as
  // before real-time collaboration existed. Computed before useSortable
  // below since it feeds that hook's own `disabled` option now.
  const lockedByNickname = useLockedBandOwner(band?.id);

  // One shared sortable session for the WHOLE row — both the ⠿ handle
  // and (see the band-content div further down) the full band cell are
  // activators for this SAME session now, not two separate dnd-kit
  // hooks. That's what makes SortableContext compute a real sibling-shift
  // transform for a full-cell/long-press drag: previously the band
  // content used its own useDraggable, which isn't a member of this
  // row's SortableContext `items` array, so no sibling ever animated for
  // it — confirmed by comparing computed `transform` on a neighboring
  // row mid-drag (handle: a real translate; band-content: "none").
  // Disabling the whole session (not just the content sub-area) while
  // locked is a small behavior tightening over the old per-activator
  // disable: previously the handle stayed draggable even while another
  // user had this exact band picked up, which is its own latent
  // inconsistency this unification also happens to close.
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id: slot.id,
    data: { type: "slot", slot, band },
    disabled: lockedByNickname !== null,
  });

  const { active } = useDndContext();
  const activePayload = active?.data.current as ActiveDragPayload | undefined;
  const draggedBand = activePayload?.band;
  const draggedBandId = draggedBand ? draggedBand.id : null;
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
      // Element-based presence (see PresenceEntry.hoveredElementId):
      // enter/leave on the WHOLE row, keyed by slot.id, is what makes a
      // Rehearsal/Break custom slot (no band to key off) track hover
      // exactly the same way a band-filled slot does — the only thing
      // every slot type shares an id for. Leaving naturally clears it, no
      // separate "moved to empty space" handling needed.
      onMouseEnter={() => useCollabStore.getState().setMyHoveredElementId(slot.id)}
      onMouseLeave={() => useCollabStore.getState().setMyHoveredElementId(null)}
      // select-none/-webkit-touch-callout/-webkit-user-drag set once here
      // cascade to every child (all three are inherited properties, and
      // touch-action's "effective" value is the intersection of an
      // element's own value with its ancestors' per the CSS Touch Events
      // spec) — no need to repeat these on the ⠿ handle or the
      // band-content div individually. touch-pan-y (not touch-action:
      // none) is deliberate: this row still needs to be scrollable by a
      // vertical swipe that doesn't hold long enough to activate the
      // TouchSensor's 500ms delay — see App.tsx's sensors comment. None
      // of this affects the desktop custom-slot <input> nested inside:
      // browsers keep native text-field editing/selection working
      // regardless of an ancestor's user-select/touch-callout, both are
      // scoped to non-editable content and links.
      className={`relative flex touch-pan-y select-none items-stretch gap-1.5 rounded-lg border p-1.5 shadow-[0_2px_6px_rgba(0,0,0,0.06)] transition-transform [-webkit-touch-callout:none] [-webkit-user-drag:none] ${
        isDragging ? "scale-[1.04] opacity-60" : ""
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
      {showDropHighlight && band && draggedBandId !== band.id && activePayload?.type === "band" && (
        // "Magnetic" insert cue — only for a genuinely UNPLACED band
        // (dragged from BandListPanel, activePayload.type === "band"):
        // dropping here won't replace this band, it'll open a new slot in
        // front of it and push this one (and everyone after it that day)
        // later. See insertBandAtSlot. An already-placed band's drag is a
        // plain reorder now (App.tsx routes it through reorderSlots), so
        // the live sibling-shift animation IS that cue for it — this
        // static label would describe the wrong mechanic.
        <div className="pointer-events-none absolute -top-2 left-2 z-10 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-md shadow-black/40">
          ⬇ ここに挿入（後ろへずれます）
        </div>
      )}
      <button
        ref={setActivatorNodeRef}
        {...listeners}
        {...attributes}
        // No touch-action: none here — App.tsx's TouchSensor uses a
        // delay-based activation constraint (long-press), which only
        // calls preventDefault() once a hold has actually been
        // recognized as a drag (see the comment there). Blocking
        // touch-action outright would stop a normal scroll gesture that
        // happens to start on this handle from ever reaching the
        // browser, which is exactly what the long-press delay exists to
        // avoid.
        className="flex min-h-11 w-8 shrink-0 cursor-grab items-center justify-center text-base text-slate-500 hover:text-slate-300 active:cursor-grabbing md:min-h-0 md:w-4 md:text-xs"
        title="ドラッグして順番を入れ替え（長押し）"
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

      <div className="flex w-[5.35rem] shrink-0 flex-col justify-center gap-0.5 font-mono text-xs text-slate-300">
        <input
          type="time"
          value={slot.startTimeOverride ?? slot.startTime}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) =>
            updateSlotContent(dayId, slot.id, {
              startTimeOverride: e.target.value || null,
            })
          }
          aria-label={`${slot.customLabel ?? band?.name ?? "空き枠"}の開始時刻`}
          title="開始時刻を上書き（以降の枠へ連鎖反映）"
          className={`w-full rounded border bg-slate-800 px-1 py-0.5 text-[11px] font-semibold outline-none transition-colors hover:bg-slate-700 focus:border-indigo-500 ${
            slot.startTimeOverride
              ? "border-indigo-500 text-indigo-200"
              : "border-slate-600 text-slate-300"
          }`}
        />
        <div className="flex items-center gap-1 whitespace-nowrap">
          <span className="text-slate-500">〜{slot.endTime}</span>
          {(slot.delayMinutes ?? 0) !== 0 && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                (slot.delayMinutes ?? 0) > 0
                  ? "bg-amber-950 text-amber-300"
                  : "bg-sky-950 text-sky-300"
              }`}
              title={(slot.delayMinutes ?? 0) > 0 ? "予定からの遅れ" : "予定より早い進行"}
            >
              {(slot.delayMinutes ?? 0) > 0
                ? `${slot.delayMinutes}分遅れ`
                : `${Math.abs(slot.delayMinutes ?? 0)}分早い`}
            </span>
          )}
          {slot.startTimeOverride && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                updateSlotContent(dayId, slot.id, { startTimeOverride: null });
              }}
              className="rounded px-1 text-[10px] text-slate-500 hover:bg-slate-700 hover:text-slate-200"
              title="時刻上書きを解除"
              aria-label="時刻上書きを解除"
            >
              ↺
            </button>
          )}
        </div>
      </div>

      {isCustom ? (
        <div className="custom-slot-card flex flex-1 items-center gap-1.5 rounded-md border px-1.5 py-1">
          {isEditingLabel ? (
            <input
              autoFocus
              className="custom-slot-label flex-1 bg-transparent text-sm font-semibold outline-none"
              value={slot.customLabel ?? ""}
              onChange={(e) =>
                updateSlotContent(dayId, slot.id, { customLabel: e.target.value })
              }
              onBlur={() => setIsEditingLabel(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
              }}
            />
          ) : (
            <div
              // Same activator session as the ⠿ handle (spread from this
              // row's own useSortable above) — this is what gives a
              // custom slot the "click anywhere on the row to drag"
              // parity a band row already has. Click (not drag) opens
              // the input above instead; distinguishing the two needs no
              // special-casing here — dnd-kit's own MouseSensor already
              // only activates a drag past an 8px movement threshold
              // (see App.tsx's sensors config), so a plain click-with-no-
              // movement always reaches onClick normally.
              {...listeners}
              {...attributes}
              onClick={() => setIsEditingLabel(true)}
              title="クリックして名前を編集"
              className={`custom-slot-label min-h-11 flex-1 select-none truncate text-sm font-semibold [-webkit-touch-callout:none] [-webkit-user-drag:none] md:min-h-0 ${
                lockedByNickname ? "cursor-not-allowed opacity-70" : "cursor-grab active:cursor-grabbing"
              }`}
            >
              {slot.customLabel || "（名称未設定）"}
            </div>
          )}
          {/* +/- stepper buttons instead of relying on the number input's
              tiny native spin arrows — easier to tap, and the input itself
              gets a visible border/background so it reads as editable
              rather than floating text. */}
          <div className="custom-slot-control flex shrink-0 items-center overflow-hidden rounded border">
            <button
              onClick={() =>
                updateSlotContent(dayId, slot.id, {
                  customDurationMinutes: Math.max(
                    1,
                    (slot.customDurationMinutes ?? 1) - 5,
                  ),
                })
              }
              className="custom-slot-control-button px-1.5 py-1 text-sm font-bold"
              title="5分減らす"
            >
              −
            </button>
            <input
              type="number"
              min={1}
              className="custom-slot-duration w-10 bg-transparent text-center text-sm font-semibold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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
              className="custom-slot-control-button px-1.5 py-1 text-sm font-bold"
              title="5分増やす"
            >
              ＋
            </button>
          </div>
          <span className="custom-slot-muted text-xs">分</span>
        </div>
      ) : (
        <div
          // Search-and-scroll target (see Timetable's search bar) — the
          // slot's own id isn't stable across a reorder/re-place the way
          // the band's own id is, so scrollIntoView/highlight target this
          // by band id, not slot id.
          id={band ? `band-slot-${band.id}` : undefined}
          className={`flex min-h-[36px] flex-1 items-center rounded-md border px-1.5 py-1 ${
            band
              ? "border-slate-700 bg-slate-900"
              : showAmbientEligible || showDropHighlight
                ? "border-dashed border-indigo-500 text-xs text-indigo-300"
                : "border-dashed border-slate-700 text-xs text-slate-500"
          } ${
            lockedByNickname
              ? "border-amber-400 border-dashed bg-amber-950/20"
              : conflict
                ? "member-conflict-highlight"
                : gearConflict
                  ? "border-amber-500 bg-amber-950/30"
                  : hasFullConcentration
                    ? "performance-concentration-full"
                    : hasConcentrationWarning
                      ? "performance-concentration-partial border-dashed"
                      : ""
          }`}
        >
          {band ? (
            <div
              // Same session as the ⠿ handle (spread from this row's own
              // useSortable above, not a separate useDraggable) — see the
              // module-level comment on why that's what makes sibling
              // rows animate live during a full-cell/long-press drag.
              // isDragging styling is intentionally NOT duplicated here:
              // the outer row already dims/scales for the whole card the
              // instant either activator starts this one shared session.
              {...listeners}
              {...attributes}
              // No touch-action: none — see the slot drag-handle button's
              // comment above; same delay-based TouchSensor, same reason.
              className={`w-full min-h-11 md:min-h-0 ${
                lockedByNickname
                  ? "cursor-not-allowed opacity-70"
                  : "cursor-grab active:cursor-grabbing"
              }`}
            >
              <p className="text-sm font-semibold text-slate-100">
                {band.name}
                {lockedByNickname && (
                  <span
                    className="ml-1.5 inline-block max-w-[9rem] truncate align-bottom whitespace-nowrap rounded border border-amber-400 bg-amber-950/60 px-1 text-xs font-normal text-amber-300"
                    title={`${lockedByNickname}が現在このバンドを移動中です`}
                  >
                    🔒 {lockedByNickname}が移動中
                  </span>
                )}
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
                <p className="member-conflict-text text-xs font-medium">
                  ⚠️ {sameBandConflictNames.join("、")} が同じバンドで連続出演しています
                </p>
              )}
              {gapConflictNames.length > 0 && (
                <p className="member-conflict-text text-xs font-medium">
                  ⚠️ {gapConflictNames.join("、")} が連続しています
                </p>
              )}
              {!conflict && gearConflict && (
                <p className="text-xs font-medium text-amber-400">
                  ⚙ 前後の枠と共有機材が重複
                </p>
              )}
              {concentrationEntries.map((c) => (
                <p
                  key={c.memberName}
                  className={`text-xs font-medium ${c.level === "full" ? "performance-concentration-text-full" : "performance-concentration-text-partial"}`}
                >
                  ⚠️ {c.memberName}{" "}
                  {formatConcentrationMessage(
                    c.totalSlots,
                    c.maxBlockSlots,
                    c.level,
                    c.blockTimeRange,
                  )}
                </p>
              ))}
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
        // alike. It sits outside the draggable band-content div above, so
        // it was never going to pick up drag listeners by accident anyway;
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
