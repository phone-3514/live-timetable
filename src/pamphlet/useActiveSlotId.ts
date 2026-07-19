import { useEffect, useState } from "react";
import type { PublicPamphletDoc } from "./types";
import { computeTransitionGaps } from "./transitionGaps";

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
