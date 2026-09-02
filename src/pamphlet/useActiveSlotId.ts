import { useEffect, useState } from "react";
import type { PublicPamphletDoc } from "./types";
import type { StageProgress } from "../store/useProgressStore";
import { computeTransitionGaps, type PamphletRow } from "./transitionGaps";

// Frequent enough to feel "live" without being wasteful — this is pure
// client-side clock math against already-cached data, not a network call,
// so there's no quota cost to ticking often.
const TICK_MS = 15_000;

function slotTimeRange(dateIso: string | null, startTime: string, endTime: string): { start: number; end: number } | null {
  if (!dateIso) return null;
  const start = new Date(`${dateIso}T${startTime}:00`).getTime();
  let end = new Date(`${dateIso}T${endTime}:00`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  if (end <= start) end += 24 * 60 * 60 * 1000; // a slot/gap that crosses midnight
  return { start, end };
}

export type ActiveRow = { id: string; kind: "slot" | "transition" };

// "Now performing" (and "now mid-transition") highlighting via a local
// setInterval comparing this device's clock against the cached schedule
// — deliberately NOT another Firestore read on a timer (that would
// defeat the whole point of the one-time-fetch/cache design in
// usePamphletCache.ts). This can drift from whatever's actually
// happening on stage (a set running long, clock skew on the viewer's
// device) — acceptable for "which row to highlight," not something any
// scheduling decision depends on.
export function useActiveSlotId(pamphlet: PublicPamphletDoc | null): ActiveRow | null {
  const [active, setActive] = useState<ActiveRow | null>(null);

  useEffect(() => {
    if (!pamphlet) {
      setActive(null);
      return;
    }

    function tick() {
      const now = Date.now();
      for (const day of pamphlet!.days) {
        for (const slot of day.slots) {
          const range = slotTimeRange(day.date, slot.startTime, slot.endTime);
          if (range && now >= range.start && now < range.end) {
            setActive({ id: slot.id, kind: "slot" });
            return;
          }
        }
        // Transition gaps are computed from the same slot times (see
        // transitionGaps.ts) — checked after real slots so a slot always
        // wins on the rare case its own times overlap a gap due to
        // malformed/edited data.
        for (const gap of computeTransitionGaps(day)) {
          const range = slotTimeRange(day.date, gap.startTime, gap.endTime);
          if (range && now >= range.start && now < range.end) {
            setActive({ id: gap.id, kind: "transition" });
            return;
          }
        }
      }
      setActive(null);
    }

    tick();
    const interval = setInterval(tick, TICK_MS);
    return () => clearInterval(interval);
  }, [pamphlet]);

  return active;
}

// Reconciles live organizer progress (StageProgress, from
// useProgressStore/usePublicProgress) with the client-side time-based
// fallback (useActiveSlotId's own return value, above) into the row that
// should actually be highlighted as "currently happening" — shared by the
// public pamphlet and, via PublicPamphletRoot's own progress/phase props,
// kept consistent with VenueScreen's identical phase-gated display logic.
//
// liveProgress.slotId truthiness alone is NOT enough to mean "this slot's
// band is currently performing": StageControlPanel's endCurrentPerformance
// and syncToCurrentTime deliberately leave slotId pointing at the
// just-finished slot while switching phase to "transition" (so the
// organizer's UI can still show what's being changed over from) — a
// caller that only checks slotId would keep highlighting the outgoing
// band as "出演中" straight through the changeover.
//
// `rows` is this same progress entry's day rendered via
// buildPamphletRows (transitionGaps.ts) — the SAME generated slot/
// transition-gap ids the pamphlet actually renders, reused here (no
// second id scheme) so a candidate is only ever returned when a matching
// row genuinely exists:
//   - "performing" resolves to the referenced row only if it's a real
//     band slot (bandId set) — never a break/custom slot.
//   - "break" resolves to the referenced row only if it's a slot with NO
//     band — never a band's own row.
//   - "transition" resolves to the *computed* transition-gap row for that
//     slot (`transition-<slotId>`, transitionGaps.ts's own id convention)
//     only if that gap actually exists (e.g. not a zero-duration/
//     back-to-back changeover with nothing rendered for it).
// Any other phase, or a slotId/kind combination with no matching row
// (stale or otherwise inconsistent progress data), shows no highlight —
// it never falls back to guessing off a band. `fallback` (the time-based
// estimate) is only ever used when there's no live progress doc/slotId at
// all, i.e. genuinely "unset."
export function resolveEffectiveActiveRow(
  liveProgress: Pick<StageProgress, "slotId" | "phase"> | null | undefined,
  rows: PamphletRow[],
  fallback: ActiveRow | null,
): ActiveRow | null {
  const slotId = liveProgress?.slotId;
  if (!slotId) return fallback;

  if (liveProgress.phase === "performing" || liveProgress.phase === "break") {
    const row = rows.find((r) => r.kind === "slot" && r.slot.id === slotId);
    if (!row || row.kind !== "slot") return null;
    const isBandRow = row.slot.bandId !== null;
    if (liveProgress.phase === "performing" ? !isBandRow : isBandRow) return null;
    return { id: row.slot.id, kind: "slot" };
  }

  if (liveProgress.phase === "transition") {
    const gapId = `transition-${slotId}`;
    const row = rows.find((r) => r.kind === "transition" && r.gap.id === gapId);
    return row ? { id: gapId, kind: "transition" } : null;
  }

  return null;
}
