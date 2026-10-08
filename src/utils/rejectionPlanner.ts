import type { TimeRange } from "./parseBands";
import type { ScheduleAvailability } from "./scheduleAvailability";

// "Who would have to be turned away?" — given the time slots a set of days can
// actually offer (each with a real start/end) and what every application says
// about when it can play, work out how many bands can be seated at all and
// which application-schedule groups the leftover come from.
//
// It's a bipartite matching problem (bands ↔ slots, an edge wherever the band's
// stated date/time window overlaps the slot — the same overlap rule the
// auto-scheduler's eligibility check uses), solved with augmenting paths, so
// the number seated is the true maximum — not a greedy estimate. Bands are
// processed in priority order and a matched band is never unmatched by a later
// augmentation, which makes the seated *set* the best possible under that
// order (the seatable sets form a matroid): with earliest-applied first, the
// ones left over are the latest applications that genuinely can't fit.
//
// A band needing more than one slot-equivalent (a 20-minute band = 2 slots)
// is modelled as that many units, all of which must be seated for the band to
// count. Consecutive-ness isn't enforced (only each slot's window), so this is
// an estimate for multi-slot bands.

export type PlannerSlot = {
  dayIndex: number;
  /** Day of month this slot falls on (null = the day has no usable date). */
  dayOfMonth: number | null;
  start: number;
  end: number;
};

export type PlannerBand = {
  id: string;
  name: string;
  /** Slot-equivalents it needs (>= 1). */
  units: number;
  availability: ScheduleAvailability;
  /** Groups bands that wrote the same schedule (see normalizeScheduleKey). */
  specKey: string;
  specLabel: string;
};

export type PlannerGroup = {
  key: string;
  label: string;
  total: number;
  seated: number;
  rejected: number;
  rejectedNames: string[];
};

export type RejectionPlan = {
  seatedBandIds: Set<string>;
  rejected: PlannerBand[];
  groups: PlannerGroup[];
  capacity: number;
  totalUnits: number;
  seatedUnits: number;
  perDaySeatedBands: Map<number, number>;
};

// Merges spellings of the same schedule so one group isn't split by spacing,
// weekday annotations or the many tilde characters: "17日(土)15:00〜、18日(日)"
// and "17日 15:00～、18日" are the same ask.
export function normalizeScheduleKey(text: string): string {
  if (!text.trim()) return "";
  return text
    .normalize("NFKC")
    .replace(/[(（][月火水木金土日][)）]/g, "")
    .replace(/\s+/g, "")
    .replace(/[~〜～]/g, "〜")
    .replace(/[、,，]/g, "、")
    .toLowerCase();
}

function rangeOverlapsSlot(range: TimeRange | null, slot: PlannerSlot): boolean {
  if (!range) return true;
  const start = range.startMinutes ?? -Infinity;
  const end = range.endMinutes ?? Infinity;
  return slot.start < end && start < slot.end;
}

export function canUseSlot(availability: ScheduleAvailability, slot: PlannerSlot): boolean {
  if (availability.windows.length === 0) return rangeOverlapsSlot(availability.globalRange, slot);
  if (slot.dayOfMonth === null) return false;
  return availability.windows.some(
    (w) => w.day === slot.dayOfMonth && rangeOverlapsSlot(w.range, slot),
  );
}

/** `bands` must already be in priority order (first = most deserving a seat). */
export function planRejections(bands: PlannerBand[], slots: PlannerSlot[]): RejectionPlan {
  type Node = { band: number; unit: number };
  const nodes: Node[] = [];
  const nodesOfBand: number[][] = bands.map(() => []);
  bands.forEach((band, b) => {
    for (let u = 0; u < Math.max(1, band.units); u++) {
      nodesOfBand[b].push(nodes.length);
      nodes.push({ band: b, unit: u });
    }
  });

  const adjacency: number[][] = nodes.map((node) =>
    slots.flatMap((slot, s) => (canUseSlot(bands[node.band].availability, slot) ? [s] : [])),
  );
  const slotOwner: number[] = slots.map(() => -1); // slot -> node index
  const nodeSlot: number[] = nodes.map(() => -1); // node -> slot

  function augment(node: number, visited: Set<number>): boolean {
    for (const s of adjacency[node]) {
      if (visited.has(s)) continue;
      visited.add(s);
      const owner = slotOwner[s];
      if (owner === -1 || augment(owner, visited)) {
        slotOwner[s] = node;
        nodeSlot[node] = s;
        return true;
      }
    }
    return false;
  }

  function unmatch(node: number) {
    const s = nodeSlot[node];
    if (s !== -1) slotOwner[s] = -1;
    nodeSlot[node] = -1;
  }

  const isSeated = (b: number) => nodesOfBand[b].every((n) => nodeSlot[n] !== -1);

  // Pass 1: every unit, in priority order.
  for (let n = 0; n < nodes.length; n++) augment(n, new Set());

  // A multi-slot band with only some units seated holds slots it can't use —
  // release them, then let the remaining unseated bands (in priority order)
  // try again for all their units, rolling a band back if it can't get them
  // all. Repeats until nothing changes.
  for (let b = 0; b < bands.length; b++) {
    if (!isSeated(b)) nodesOfBand[b].forEach(unmatch);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (let b = 0; b < bands.length; b++) {
      if (isSeated(b)) continue;
      const ok = nodesOfBand[b].every((n) => augment(n, new Set()));
      if (ok) changed = true;
      else nodesOfBand[b].forEach(unmatch);
    }
  }

  const seatedBandIds = new Set<string>();
  const rejected: PlannerBand[] = [];
  const perDaySeatedBands = new Map<number, number>();
  bands.forEach((band, b) => {
    if (isSeated(b)) {
      seatedBandIds.add(band.id);
      const day = slots[nodeSlot[nodesOfBand[b][0]]].dayIndex;
      perDaySeatedBands.set(day, (perDaySeatedBands.get(day) ?? 0) + 1);
    } else {
      rejected.push(band);
    }
  });

  const groupMap = new Map<string, PlannerGroup>();
  for (const band of bands) {
    const group = groupMap.get(band.specKey) ?? {
      key: band.specKey,
      label: band.specLabel,
      total: 0,
      seated: 0,
      rejected: 0,
      rejectedNames: [],
    };
    group.total++;
    if (seatedBandIds.has(band.id)) group.seated++;
    else {
      group.rejected++;
      group.rejectedNames.push(band.name);
    }
    groupMap.set(band.specKey, group);
  }
  const groups = [...groupMap.values()].sort(
    (a, b) => b.rejected - a.rejected || b.total - a.total || a.label.localeCompare(b.label, "ja"),
  );

  return {
    seatedBandIds,
    rejected,
    groups,
    capacity: slots.length,
    totalUnits: nodes.length,
    seatedUnits: bands.reduce((sum, band, b) => sum + (isSeated(b) ? band.units : 0), 0),
    perDaySeatedBands,
  };
}
