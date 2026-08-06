import type { Band, TimetableDay, TimetableSlot } from "../types";
import type { VenueHours } from "./parseBands";
import { canPlaceBandInSlot } from "./scheduleEligibility";
import { recomputeTimes } from "./scheduleTimes";
import { normalizeMemberName } from "./normalizeMemberName";
import { timeToMinutes } from "./time";
import { DEFAULT_LIVE_COMPOSITION_RATING, getLiveCompositionRating } from "./liveCompositionRating";

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

// Hard-constraint proxy: every placed band must satisfy its own
// availability (time designation) for the slot it landed in.
function eligibilityPenalty(
  slots: TimetableSlot[],
  day: TimetableDay,
  bandMap: Map<string, Band>,
  venueHours: VenueHours,
): number {
  let penalty = 0;
  for (const slot of slots) {
    if (!slot.bandId) continue;
    const band = bandMap.get(slot.bandId);
    if (band && !canPlaceBandInSlot(band, day, slot, venueHours)) {
      penalty += INELIGIBLE_SLOT_PENALTY;
    }
  }
  return penalty;
}

// Constraint A + C: literal array-adjacent slot pairs. Returns both
// penalties from one shared pass since they're both computed off the same
// pair — kept as one function so Step 2 (see computeHardConstraintPenalty
// below) and scoreArrangement can each pick only the parts they need
// without walking the slot list twice or re-deriving the adjacency logic.
function adjacencyPenalties(
  slots: TimetableSlot[],
  bandMap: Map<string, Band>,
): { consecutiveMemberPenalty: number; sameArtistPenalty: number } {
  let consecutiveMemberPenalty = 0;
  let sameArtistPenalty = 0;
  for (let i = 0; i < slots.length - 1; i++) {
    const a = slots[i];
    const b = slots[i + 1];
    if (!a.bandId || !b.bandId) continue;
    const bandA = bandMap.get(a.bandId);
    const bandB = bandMap.get(b.bandId);
    if (!bandA || !bandB) continue;

    if (bandA.name && bandA.name === bandB.name) {
      sameArtistPenalty += SAME_ARTIST_ADJACENCY_PENALTY;
    }

    if (a.startTime && a.endTime && b.startTime && b.endTime) {
      const gap = timeToMinutes(b.startTime) - timeToMinutes(a.endTime);
      if (gap <= 0) {
        const membersA = new Set(bandA.members.map(normalizeMemberName));
        const sharesMember = bandB.members.some((m) => membersA.has(normalizeMemberName(m)));
        if (sharesMember) consecutiveMemberPenalty += CONSECUTIVE_MEMBER_PENALTY;
      }
    }
  }
  return { consecutiveMemberPenalty, sameArtistPenalty };
}

// Constraint B: 100% block concentration (a member with 2+ performances
// that day, all landing in the same block).
function blockConcentrationPenalty(slots: TimetableSlot[], bandMap: Map<string, Band>): number {
  let penalty = 0;
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

// Scores one candidate day arrangement — lower is better, 0 is a
// perfectly clean schedule. Takes the day only for its `.id` (eligibility
// needs it) and `.settings` are already baked into `slots`' start/end
// times by the caller before this is called. Unchanged from before the
// Step 2 (ライブ構成評価) addition — same four penalty components, same
// total — just decomposed into the shared helpers above so Step 2 can
// reuse the hard-constraint subset without a second implementation.
function scoreArrangement(
  slots: TimetableSlot[],
  day: TimetableDay,
  bands: Band[],
  venueHours: VenueHours,
): number {
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const { consecutiveMemberPenalty, sameArtistPenalty } = adjacencyPenalties(slots, bandMap);
  return (
    eligibilityPenalty(slots, day, bandMap, venueHours) +
    consecutiveMemberPenalty +
    sameArtistPenalty +
    blockConcentrationPenalty(slots, bandMap)
  );
}

// Step 2's hard-constraint gate — the same three checks the user's spec
// calls out as hard (時間指定 via eligibilityPenalty, 連続出演禁止 via
// consecutiveMemberPenalty, ブロック分散ルール via
// blockConcentrationPenalty), reusing the exact same functions
// scoreArrangement uses for Step 1 rather than reimplementing any of
// them. Same-artist adjacency is deliberately excluded — it's a soft
// preference in this codebase, not one of the constraints Step 2 is
// required to treat as hard.
export function computeHardConstraintPenalty(
  slots: TimetableSlot[],
  day: TimetableDay,
  bands: Band[],
  venueHours: VenueHours,
): number {
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  return (
    eligibilityPenalty(slots, day, bandMap, venueHours) +
    adjacencyPenalties(slots, bandMap).consecutiveMemberPenalty +
    blockConcentrationPenalty(slots, bandMap)
  );
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

// ---------- Step 2: ライブ構成評価による改善 --------------------------------
//
// Takes Step 1's output (solveDayAssignment's result) as input and looks
// for slot-to-slot swaps, within that same day, that move higher-rated
// bands later and lower-rated bands earlier — without ever letting the
// hard-constraint penalty (computeHardConstraintPenalty, the same
// function Step 1's own scoring is built from) get worse than it already
// was. It's a bounded, deterministic local search, not a sort: a plain
// "sort placed bands by rating" would ignore every hard constraint Step 1
// just satisfied and could easily reintroduce a consecutive-member clash
// or break the block-distribution rule.

// Bounded the same way MAX_ITERATIONS bounds Step 1 — a full pass over
// every pair is O(n^2) for a day's band count (dozens at this app's
// scale), and convergence (no improving swap found) is expected within a
// handful of passes since every accepted swap must strictly increase the
// score and the score is bounded.
const MAX_COMPOSITION_PASSES = 20;

function normalizedPositionOf(index: number, total: number): number {
  if (total <= 1) return 0;
  return index / (total - 1);
}

// 拡張可能な評価設計: this is the one score*() function implemented today.
// A future factor (学年/人気度/特別出演/イベントテーマ/ジャンル傾向) would be
// its own score*(band, normalizedPosition) function, added as one more
// term in scoreSchedule below — nothing about the search loop in
// improveDayByLiveComposition would need to change.
//
// 評価5(最大)ほど後半(normalizedPosition→1)が望ましく、評価1(最小)ほど前半
// (→0)が望ましい。評価3(既定値)は中立 — bias 0 で位置に関わらず常に0を返す。
function scoreLiveComposition(band: Band, normalizedPosition: number): number {
  const rating = getLiveCompositionRating(band);
  const bias = rating - DEFAULT_LIVE_COMPOSITION_RATING;
  return bias * normalizedPosition;
}

// Sums every independent score*() factor across the day's performance-slot
// order. Only scoreLiveComposition exists today; adding a factor later is
// `score += scoreNewFactor(...)` here plus its own function above.
function scoreSchedule(orderedBandIds: (string | null)[], bandMap: Map<string, Band>): number {
  let score = 0;
  const total = orderedBandIds.length;
  orderedBandIds.forEach((bandId, index) => {
    if (!bandId) return;
    const band = bandMap.get(bandId);
    if (!band) return;
    score += scoreLiveComposition(band, normalizedPositionOf(index, total));
  });
  return score;
}

// Refines `day.slots` (expected to already be Step 1's output — this
// module never calls solveDayAssignment itself) by repeatedly swapping
// pairs of currently-filled performance slots, keeping a swap only when
// it (a) doesn't raise the hard-constraint penalty computed by
// computeHardConstraintPenalty and (b) strictly improves scoreSchedule.
// Ties are left alone, so an all-rating-3 day (or any day where no
// feasible improving swap exists) comes back byte-for-byte identical to
// Step 1's order. Deterministic — no Math.random anywhere in this
// function — so the same input always produces the same output, unlike
// Step 1's simulated annealing (which doesn't need that property).
export function improveDayByLiveComposition(
  day: TimetableDay,
  bands: Band[],
  venueHours: VenueHours,
): TimetableSlot[] {
  // Only rows that are actual performance slots (not 休憩・集合 dividers)
  // count toward "前半/後半" position — divider rows don't shift when a
  // band later in the array-index order still occupies an earlier
  // performance position, so this mirrors solveDayAssignment's own
  // definition of "the slots this feature is allowed to touch".
  const performanceIndices = day.slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot.customLabel === null)
    .map(({ index }) => index);

  // Step 2 only ever swaps bands that are already placed — it never fills
  // a slot Step 1 left empty (that's a placement decision, out of scope
  // for a composition refinement) and never touches non-performance rows.
  const filledPositions = performanceIndices.filter((i) => day.slots[i].bandId !== null);
  if (filledPositions.length < 2) return day.slots;

  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const orderedBandIds = (slots: TimetableSlot[]) => performanceIndices.map((i) => slots[i].bandId);

  let slots = day.slots;
  let currentHardPenalty = computeHardConstraintPenalty(slots, day, bands, venueHours);
  let currentScore = scoreSchedule(orderedBandIds(slots), bandMap);

  let improved = true;
  let passes = 0;
  while (improved && passes < MAX_COMPOSITION_PASSES) {
    improved = false;
    passes++;
    for (let a = 0; a < filledPositions.length - 1; a++) {
      for (let b = a + 1; b < filledPositions.length; b++) {
        const posA = filledPositions[a];
        const posB = filledPositions[b];
        const bandIdA = slots[posA].bandId;
        const bandIdB = slots[posB].bandId;
        if (bandIdA === bandIdB) continue;

        const candidate = [...slots];
        candidate[posA] = { ...candidate[posA], bandId: bandIdB };
        candidate[posB] = { ...candidate[posB], bandId: bandIdA };
        const recomputed = recomputeTimes(candidate, day.settings, bands);

        // Reuse Step 1's own hard-constraint check — reject outright if
        // this swap would make any of the hard constraints (time
        // designation, consecutive-member, block distribution) worse
        // than they already are, no matter how much it would improve the
        // composition score.
        const candidateHardPenalty = computeHardConstraintPenalty(recomputed, day, bands, venueHours);
        if (candidateHardPenalty > currentHardPenalty) continue;

        const candidateScore = scoreSchedule(orderedBandIds(recomputed), bandMap);
        if (candidateScore <= currentScore) continue;

        slots = recomputed;
        currentHardPenalty = candidateHardPenalty;
        currentScore = candidateScore;
        improved = true;
      }
    }
  }

  return slots;
}
