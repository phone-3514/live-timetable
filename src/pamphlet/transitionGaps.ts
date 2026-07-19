import type { PublicDay, PublicSlot } from "./types";

export type TransitionGap = {
  /** Stable across renders (derived from the slot before the gap), and
   * used as the DOM id (`pamphlet-slot-<id>`) so the same auto-scroll/
   * highlight machinery that targets a real slot also works for a gap. */
  id: string;
  /** The slot this gap immediately follows — buildPamphletRows uses this
   * to insert the gap in the right place, rather than re-deriving it from
   * array position (day.slots and the gaps array have different lengths
   * whenever some adjacent pairs have no gap at all, so a positional
   * match is wrong — this bit the first version of this file). */
  afterSlotId: string;
  startTime: string;
  endTime: string;
};

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// A day's schedule already bakes each performance's transition time into
// the gap between one slot's endTime and the next slot's startTime (see
// useAppStore.ts's schedule generation — transitionMinutes is added
// between consecutive slots' recorded times, not stored as its own
// field). So "転換中" needs no extra data from the admin side at all: any
// genuine gap between two adjacent slots in the already-fetched
// PublicSlot[] IS the transition period, computed purely client-side
// here. A zero-or-negative gap (back-to-back slots, or a custom slot
// like 休憩 that already represents the same idea) produces nothing.
// `day.slots` is assumed to already be in chronological/performance
// order, same as everywhere else in this app that walks a slots array.
export function computeTransitionGaps(day: PublicDay): TransitionGap[] {
  const gaps: TransitionGap[] = [];
  const slots = day.slots;
  for (let i = 0; i < slots.length - 1; i++) {
    const end = toMinutes(slots[i].endTime);
    const start = toMinutes(slots[i + 1].startTime);
    if (end === null || start === null || start <= end) continue;
    gaps.push({
      id: `transition-${slots[i].id}`,
      afterSlotId: slots[i].id,
      startTime: slots[i].endTime,
      endTime: slots[i + 1].startTime,
    });
  }
  return gaps;
}

// Merges a day's real slots with its computed transition gaps into one
// chronologically-ordered render list, tagging each entry so the caller
// can render a "転換中" row distinctly from a band/custom-slot row.
export type PamphletRow = { kind: "slot"; slot: PublicSlot } | { kind: "transition"; gap: TransitionGap };

export function buildPamphletRows(day: PublicDay): PamphletRow[] {
  const gaps = computeTransitionGaps(day);
  const gapAfterSlotId = new Map(gaps.map((g) => [g.afterSlotId, g]));
  const rows: PamphletRow[] = [];
  for (const slot of day.slots) {
    rows.push({ kind: "slot", slot });
    const gap = gapAfterSlotId.get(slot.id);
    if (gap) rows.push({ kind: "transition", gap });
  }
  return rows;
}
