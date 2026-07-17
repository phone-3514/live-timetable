import type { Band, TimetableDay, TimetableSlot } from "../types";
import type { VenueHours } from "./parseBands";
import { canPlaceBandInSlot } from "./scheduleEligibility";
import { recomputeTimes } from "./scheduleTimes";
import { normalizeMemberName } from "./normalizeMemberName";
import { timeToMinutes } from "./time";

// 自動編成アシスト (Auto-Draft Assist) — a small CSP solver run per day.
// A day's target band list is already fixed in size (one-to-one with that
// day's empty performance slots) by the caller's balancing pass; this
// module's only job is to choose which band goes in which of those slots
// so the resulting schedule scores as few penalty points as possible.
// There's no known-fast exact algorithm for this (it's a permutation
// search over n! orderings), so it uses simulated annealing: random
// pairwise swaps, always keeping improvements, sometimes accepting a worse
// swap (with a probability that shrinks over time) to escape local minima,
// and remembering the best arrangement seen across the whole run.

// Constraint A (heavy): the same member in two array-adjacent slots with a
// real time gap of zero or less — they'd have to be in two places at once.
const CONSECUTIVE_MEMBER_PENALTY = 1000;
// Constraint B (medium): a member with 2+ performances that day, 100% of
// which land in the same block (the stretch between break/custom slots) —
// they never get a real rest, though it's not a physical impossibility.
const BLOCK_CONCENTRATION_PENALTY = 100;
// Constraint C (medium): the exact same artist/band name in two
// array-adjacent slots — dull for the audience, not infeasible.
const SAME_ARTIST_ADJACENCY_PENALTY = 100;
// Hard-constraint proxy: a band placed outside its own declared
// availability (allowedDayIds / desiredTime / ngTime). Deliberately far
// larger than any combination of the soft penalties above so the search
// always prefers a feasible swap over an infeasible one when any exists —
// annealing never "needs" to cross this to reach a better score.
const INELIGIBLE_SLOT_PENALTY = 100_000;

// Bounded so a single solve() call can't noticeably stall the UI even for
// an unusually large day — within the 1000–5000 range this feature was
// scoped to. Each iteration is O(slot count), so even the top of that
// range stays well under real-time budgets for any timetable someone
// would actually build by hand.
const MAX_ITERATIONS = 1500;

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Same block-dividing rule as computeSlotBlocks in useAppStore (customLabel
// slots are dividers), reimplemented locally over a plain slot array —
// this module intentionally has zero dependency on the store so it stays
// a pure, independently testable algorithm.
function computeBlockBySlotId(slots: TimetableSlot[]): Map<string, number> {
  const blockBySlotId = new Map<string, number>();
  let block = 0;
  for (const slot of slots) {
    if (slot.customLabel !== null) {
      block++;
      continue;
    }
    if (slot.bandId) blockBySlotId.set(slot.id, block);
  }
  return blockBySlotId;
}

// Scores one candidate day arrangement — lower is better, 0 is a
// perfectly clean schedule. Takes the day only for its `.id` (eligibility
// needs it) and `.settings` are already baked into `slots`' start/end
// times by the caller before this is called.
function scoreArrangement(
  slots: TimetableSlot[],
  day: TimetableDay,
  bands: Band[],
  venueHours: VenueHours,
): number {
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  let penalty = 0;

  // Hard-constraint proxy: every placed band must satisfy its own
  // availability for the slot it landed in.
  for (const slot of slots) {
    if (!slot.bandId) continue;
    const band = bandMap.get(slot.bandId);
    if (band && !canPlaceBandInSlot(band, day, slot, venueHours)) {
      penalty += INELIGIBLE_SLOT_PENALTY;
    }
  }

  // Constraint A + C: literal array-adjacent slot pairs.
  for (let i = 0; i < slots.length - 1; i++) {
    const a = slots[i];
    const b = slots[i + 1];
    if (!a.bandId || !b.bandId) continue;
    const bandA = bandMap.get(a.bandId);
    const bandB = bandMap.get(b.bandId);
    if (!bandA || !bandB) continue;

    if (bandA.name && bandA.name === bandB.name) {
      penalty += SAME_ARTIST_ADJACENCY_PENALTY;
    }

    if (a.startTime && a.endTime && b.startTime && b.endTime) {
      const gap = timeToMinutes(b.startTime) - timeToMinutes(a.endTime);
      if (gap <= 0) {
        const membersA = new Set(bandA.members.map(normalizeMemberName));
        const sharesMember = bandB.members.some((m) => membersA.has(normalizeMemberName(m)));
        if (sharesMember) penalty += CONSECUTIVE_MEMBER_PENALTY;
      }
    }
  }

  // Constraint B: 100% block concentration.
  const blockBySlotId = computeBlockBySlotId(slots);
  const byMember = new Map<string, { count: number; blocks: Set<number> }>();
  for (const slot of slots) {
    if (!slot.bandId) continue;
    const band = bandMap.get(slot.bandId);
    if (!band) continue;
    const block = blockBySlotId.get(slot.id);
    if (block === undefined) continue;
    const seenInThisSlot = new Set<string>();
    for (const rawName of band.members) {
      const key = normalizeMemberName(rawName);
      if (!key || seenInThisSlot.has(key)) continue;
      seenInThisSlot.add(key);
      const entry = byMember.get(key) ?? { count: 0, blocks: new Set<number>() };
      entry.count++;
      entry.blocks.add(block);
      byMember.set(key, entry);
    }
  }
  for (const { count, blocks } of byMember.values()) {
    if (count >= 2 && blocks.size === 1) penalty += BLOCK_CONCENTRATION_PENALTY;
  }

  return penalty;
}

// Fills `day`'s empty performance slots with `candidateBands` (expected to
// be the same length — the caller's balancing pass sizes them to match,
// but this clamps defensively if not) by searching for a low-penalty
// ordering via simulated annealing, then returns the day's full slot list
// with times recomputed. Any candidate that's still ineligible for its
// slot in the best arrangement found is pulled back out rather than
// force-placed — a genuinely infeasible fit (no slot on this day satisfies
// that band's own desired/NG time window) should leave the slot empty,
// the same way a manual placement attempt would refuse it.
export function solveDayAssignment(
  day: TimetableDay,
  candidateBands: Band[],
  allBands: Band[],
  venueHours: VenueHours,
): TimetableSlot[] {
  const emptyPositions = day.slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot.bandId === null && slot.customLabel === null)
    .map(({ index }) => index);

  if (emptyPositions.length === 0 || candidateBands.length === 0) {
    return day.slots;
  }

  const n = Math.min(emptyPositions.length, candidateBands.length);
  const positions = emptyPositions.slice(0, n);
  const pool = candidateBands.slice(0, n);

  function buildSlots(order: Band[]): TimetableSlot[] {
    const slots = [...day.slots];
    positions.forEach((slotIndex, i) => {
      slots[slotIndex] = { ...slots[slotIndex], bandId: order[i].id };
    });
    return recomputeTimes(slots, day.settings, allBands);
  }

  let current = shuffle(pool);
  let currentSlots = buildSlots(current);
  let currentPenalty = scoreArrangement(currentSlots, day, allBands, venueHours);
  let best = current;
  let bestPenalty = currentPenalty;

  for (let iter = 0; iter < MAX_ITERATIONS && n > 1 && bestPenalty > 0; iter++) {
    const i = Math.floor(Math.random() * n);
    let j = Math.floor(Math.random() * n);
    if (j === i) j = (j + 1) % n;

    const candidate = [...current];
    [candidate[i], candidate[j]] = [candidate[j], candidate[i]];
    const candidateSlots = buildSlots(candidate);
    const candidatePenalty = scoreArrangement(candidateSlots, day, allBands, venueHours);

    const delta = candidatePenalty - currentPenalty;
    const temperature = 1 - iter / MAX_ITERATIONS;
    if (delta <= 0 || Math.random() < Math.exp(-delta / (temperature * 50 + 1))) {
      current = candidate;
      currentPenalty = candidatePenalty;
      if (currentPenalty < bestPenalty) {
        best = current;
        bestPenalty = currentPenalty;
      }
    }
  }

  let finalSlots = buildSlots(best);
  const bandMap = new Map(allBands.map((b) => [b.id, b]));
  finalSlots = finalSlots.map((slot) => {
    if (!slot.bandId) return slot;
    const band = bandMap.get(slot.bandId);
    if (band && !canPlaceBandInSlot(band, day, slot, venueHours)) {
      return { ...slot, bandId: null };
    }
    return slot;
  });
  return recomputeTimes(finalSlots, day.settings, allBands);
}
