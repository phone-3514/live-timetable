import type { Band, TimetableDay, TimetableSlot } from "../types";
import type { VenueHours } from "./parseBands";
import { canPlaceBandInSlot } from "./scheduleEligibility";
import { recomputeTimes } from "./scheduleTimes";
import { normalizeMemberName } from "./normalizeMemberName";
import { timeToMinutes } from "./time";
import { getLiveCompositionRating } from "./liveCompositionRating";

// 自動編成アシスト (Auto-Draft Assist) — a small CSP solver run per day.
// A day's target band list is already fixed in size (one-to-one with that
// day's empty performance slots) by the caller's balancing pass; this
// module's only job is to choose which band goes in which of those slots.
//
// The search is split into two clearly separated concerns, per this
// feature's own design requirement (never blend them into one weighted
// score):
//
// - HARD constraints (isValidSchedule / validateHardConstraints below) —
//   time designation, no back-to-back same-member appearances, and no
//   more than ceil(N/2) same-block appearances for anyone performing in N
//   bands that day. A candidate that violates any of these is excluded
//   outright, never merely penalized.
// - SOFT constraints (evaluateSchedule / scoreComponents below) — among
//   every hard-constraint-satisfying candidate, prefer one where each
//   break-to-break block's ライブ構成評価 rises gently toward its close.
//
// Step 1 (solveDayAssignment) finds an initial hard-constraint-satisfying
// placement via simulated annealing over the *violation count* (not a
// blended score). Step 2/3 (improveDayByLiveComposition) then performs a
// deterministic swap-based local search that only ever moves between
// valid states, picking the one with the best soft score.

// ---------- Blocks ------------------------------------------------------
//
// A day's timetable is split into "blocks" by its non-band rows (休憩・
// 集合・リハーサルなど — anything with a customLabel). Block 0 is
// everything before the first such row, block 1 is everything between the
// first and second, and so on. A block's `slotIds` lists every
// performance row in it (filled or still empty) in chronological order;
// the divider rows themselves belong to no block.
export type ScheduleBlock = {
  id: string;
  startTime: string;
  endTime: string;
  slotIds: string[];
};

export function computeScheduleBlocks(slots: TimetableSlot[]): ScheduleBlock[] {
  const blocks: ScheduleBlock[] = [];
  let blockIndex = 0;
  let slotIds: string[] = [];
  let startTime: string | null = null;
  let endTime: string | null = null;

  function flush() {
    if (slotIds.length > 0) {
      blocks.push({ id: `block-${blockIndex}`, startTime: startTime ?? "", endTime: endTime ?? "", slotIds });
    }
  }

  for (const slot of slots) {
    if (slot.customLabel !== null) {
      flush();
      blockIndex++;
      slotIds = [];
      startTime = null;
      endTime = null;
      continue;
    }
    slotIds.push(slot.id);
    if (startTime === null && slot.startTime) startTime = slot.startTime;
    if (slot.endTime) endTime = slot.endTime;
  }
  flush();
  return blocks;
}

// The read-only context every hard/soft check needs. `blocks` is computed
// once from the day's slot *structure* (divider positions never move
// during a search — only which band occupies which already-existing
// performance slot changes), so it's safe to reuse across an entire
// search rather than recomputing it every candidate.
export type ScheduleContext = {
  day: TimetableDay;
  allBands: Band[];
  venueHours: VenueHours;
  blocks: ScheduleBlock[];
};

// ---------- Hard constraint 1: consecutive appearance --------------------
//
// Kept as its own exported function (rather than inlined into
// validateHardConstraints) specifically so the "how long a break has to
// be before it stops counting as consecutive" decision lives in exactly
// one place and can be revisited independently later. Today it matches
// this app's existing behavior: any customLabel row between two
// performances already breaks adjacency entirely (see the raw
// array-adjacent iteration in validateHardConstraints — a divider row
// sits between them, so they're never compared here at all), and among
// directly-adjacent performance rows, a real time gap of zero or less is
// what "consecutive" means. This is intentionally the app's own rule, not
// getMemberConflictDetails' separate (stricter, transitionMinutes-based)
// manual-editing warning threshold in useAppStore.ts — that's a different
// advisory feature with its own definition, left untouched.
export function violatesConsecutiveAppearance(
  previous: { band: Band; slot: TimetableSlot },
  next: { band: Band; slot: TimetableSlot },
): boolean {
  if (!previous.slot.startTime || !previous.slot.endTime || !next.slot.startTime || !next.slot.endTime) {
    return false;
  }
  const gap = timeToMinutes(next.slot.startTime) - timeToMinutes(previous.slot.endTime);
  if (gap > 0) return false;
  const previousMembers = new Set(previous.band.members.map(normalizeMemberName));
  return next.band.members.some((m) => previousMembers.has(normalizeMemberName(m)));
}

// ---------- Hard constraint 2: block concentration ------------------------
//
// A person appearing in N bands that day may occupy at most ceil(N/2) of
// them within any single block — so 2 appearances must split across at
// least 2 blocks, 3–4 allow at most 2 in one block, 5 allow at most 3, etc.
export type PersonAppearanceDistribution = {
  personId: string;
  displayName: string;
  totalAppearances: number;
  appearancesByBlock: Record<string, number>;
  maxAllowedPerBlock: number;
};

export function computePersonAppearanceDistribution(
  slots: TimetableSlot[],
  bands: Band[],
  blocks: ScheduleBlock[],
): PersonAppearanceDistribution[] {
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const slotById = new Map(slots.map((s) => [s.id, s]));

  const byPerson = new Map<string, { displayName: string; countsByBlock: Map<string, number> }>();
  for (const block of blocks) {
    for (const slotId of block.slotIds) {
      const slot = slotById.get(slotId);
      if (!slot?.bandId) continue;
      const band = bandMap.get(slot.bandId);
      if (!band) continue;
      const seenInThisSlot = new Set<string>();
      for (const rawName of band.members) {
        const key = normalizeMemberName(rawName);
        if (!key || seenInThisSlot.has(key)) continue;
        seenInThisSlot.add(key);
        const entry = byPerson.get(key) ?? { displayName: rawName, countsByBlock: new Map<string, number>() };
        entry.countsByBlock.set(block.id, (entry.countsByBlock.get(block.id) ?? 0) + 1);
        byPerson.set(key, entry);
      }
    }
  }

  return [...byPerson.entries()].map(([personId, { displayName, countsByBlock }]) => {
    const totalAppearances = [...countsByBlock.values()].reduce((sum, count) => sum + count, 0);
    const appearancesByBlock: Record<string, number> = {};
    countsByBlock.forEach((count, blockId) => {
      appearancesByBlock[blockId] = count;
    });
    return {
      personId,
      displayName,
      totalAppearances,
      appearancesByBlock,
      maxAllowedPerBlock: Math.ceil(totalAppearances / 2),
    };
  });
}

export function violatesBlockConcentration(
  personId: string,
  slots: TimetableSlot[],
  bands: Band[],
  blocks: ScheduleBlock[],
): boolean {
  const distribution = computePersonAppearanceDistribution(slots, bands, blocks).find(
    (d) => d.personId === personId,
  );
  if (!distribution) return false;
  return Object.values(distribution.appearancesByBlock).some((count) => count > distribution.maxAllowedPerBlock);
}

// ---------- Hard constraint validation (all three, combined) -------------
//
// Richer than a plain string list — each violation keeps the slot/band/
// person ids responsible, since both the debug output and this module's
// own "drop the worst offender" safety net (pruneToValidSchedule) need to
// act on *who* violated *what*, not just a human-readable sentence. Every
// violation's `.message` is still a ready-to-display string.
export type HardConstraintViolationType = "TIME_CONSTRAINT" | "CONSECUTIVE_APPEARANCE" | "BLOCK_CONCENTRATION";
export type HardConstraintViolation = {
  type: HardConstraintViolationType;
  message: string;
  slotIds: string[];
  bandIds: string[];
  personIds?: string[];
};
export type ValidationResult = {
  isValid: boolean;
  violations: HardConstraintViolation[];
};

export function validateHardConstraints(slots: TimetableSlot[], context: ScheduleContext): ValidationResult {
  const violations: HardConstraintViolation[] = [];
  const bandMap = new Map(context.allBands.map((b) => [b.id, b]));

  // 1. 出演可能時間・時間指定
  for (const slot of slots) {
    if (!slot.bandId) continue;
    const band = bandMap.get(slot.bandId);
    if (band && !canPlaceBandInSlot(band, context.day, slot, context.venueHours)) {
      violations.push({
        type: "TIME_CONSTRAINT",
        message: `${band.name}が出演可能時間外の枠(${slot.startTime || "?"})に配置されています`,
        slotIds: [slot.id],
        bandIds: [band.id],
      });
    }
  }

  // 2. 同一人物の連続出演禁止 — raw array-adjacent slots only, so a divider
  // row between two performances already breaks adjacency entirely.
  for (let i = 0; i < slots.length - 1; i++) {
    const a = slots[i];
    const b = slots[i + 1];
    if (!a.bandId || !b.bandId) continue;
    const bandA = bandMap.get(a.bandId);
    const bandB = bandMap.get(b.bandId);
    if (!bandA || !bandB) continue;
    if (violatesConsecutiveAppearance({ band: bandA, slot: a }, { band: bandB, slot: b })) {
      const membersA = new Set(bandA.members.map(normalizeMemberName));
      const sharedPersonIds = [...new Set(bandB.members.map(normalizeMemberName))].filter((id) =>
        membersA.has(id),
      );
      violations.push({
        type: "CONSECUTIVE_APPEARANCE",
        message: `${bandA.name}と${bandB.name}に同一メンバーが連続出演しています`,
        slotIds: [a.id, b.id],
        bandIds: [bandA.id, bandB.id],
        personIds: sharedPersonIds,
      });
    }
  }

  // 3. 同一人物のブロック集中制限 (ceil(N/2))
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const distribution = computePersonAppearanceDistribution(slots, context.allBands, context.blocks);
  for (const person of distribution) {
    for (const [blockId, count] of Object.entries(person.appearancesByBlock)) {
      if (count <= person.maxAllowedPerBlock) continue;
      const block = context.blocks.find((b) => b.id === blockId);
      const offendingSlotIds = (block?.slotIds ?? []).filter((slotId) => {
        const slot = slotById.get(slotId);
        if (!slot?.bandId) return false;
        const band = bandMap.get(slot.bandId);
        return band?.members.some((m) => normalizeMemberName(m) === person.personId) ?? false;
      });
      violations.push({
        type: "BLOCK_CONCENTRATION",
        message: `${person.displayName}が同一ブロックに${count}回出演しています（上限${person.maxAllowedPerBlock}回）`,
        slotIds: offendingSlotIds,
        bandIds: [...new Set(offendingSlotIds.map((id) => slotById.get(id)!.bandId!))],
        personIds: [person.personId],
      });
    }
  }

  return { isValid: violations.length === 0, violations };
}

export function isValidSchedule(slots: TimetableSlot[], context: ScheduleContext): boolean {
  return validateHardConstraints(slots, context).violations.length === 0;
}

// ---------- Soft constraints: ライブ構成評価 -------------------------------
//
// Position/rating are both normalized to 0〜1 and compared *within each
// block independently* — the scoring resets at every break, since a
// block's own "トリ" (closing slot) is what should get the highest-rated
// band, not the day's literal last slot.
export function getNormalizedPosition(index: number, totalSlots: number): number {
  if (totalSlots <= 1) return 1;
  return index / (totalSlots - 1);
}

export function normalizeRating(rating: number): number {
  return (rating - 1) / 4;
}

export function calculatePositionRatingPenalty(normalizedPosition: number, rating: number): number {
  return Math.abs(normalizedPosition - normalizeRating(rating));
}

// Some downward steps (a later band rated lower than the one before it)
// are fine — this is a soft preference for a gentle rise, not a strict
// monotonic order.
export function calculateDescendingPenalty(currentRating: number, nextRating: number): number {
  return Math.max(0, currentRating - nextRating);
}

export function calculateBlockClosingBonus(rating: number): number {
  return normalizeRating(rating);
}

function getBlockEntries(
  slots: TimetableSlot[],
  bandMap: Map<string, Band>,
  block: ScheduleBlock,
): { slot: TimetableSlot; band: Band }[] {
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const entries: { slot: TimetableSlot; band: Band }[] = [];
  for (const slotId of block.slotIds) {
    const slot = slotById.get(slotId);
    if (!slot?.bandId) continue;
    const band = bandMap.get(slot.bandId);
    if (band) entries.push({ slot, band });
  }
  return entries;
}

// 拡張可能な評価設計: each ScoreComponent is an independent, named factor.
// A future one (学年/人気度/特別出演/イベントテーマ/ジャンル傾向/固定順序/
// PA・機材転換の都合など) is just one more entry in scoreComponents below
// — nothing about the search loops in solveDayAssignment or
// improveDayByLiveComposition needs to change.
export type ScoreComponent = {
  name: string;
  weight: number;
  calculate: (slots: TimetableSlot[], context: ScheduleContext) => number;
};

const positionRatingComponent: ScoreComponent = {
  name: "positionRating",
  weight: 1,
  calculate: (slots, context) => {
    const bandMap = new Map(context.allBands.map((b) => [b.id, b]));
    let totalPenalty = 0;
    for (const block of context.blocks) {
      const entries = getBlockEntries(slots, bandMap, block);
      entries.forEach(({ band }, index) => {
        const rating = getLiveCompositionRating(band);
        const position = getNormalizedPosition(index, entries.length);
        totalPenalty += calculatePositionRatingPenalty(position, rating);
      });
    }
    return -totalPenalty;
  },
};

// Weighted down relative to positionRating (raw 1〜5 differences, not
// normalized 0〜1, so its natural scale is ~4x larger) so it acts as a
// tie-breaking nudge among positionRating-equivalent candidates rather
// than dominating the search.
const descendingPenaltyComponent: ScoreComponent = {
  name: "descendingPenalty",
  weight: 0.25,
  calculate: (slots, context) => {
    const bandMap = new Map(context.allBands.map((b) => [b.id, b]));
    let totalPenalty = 0;
    for (const block of context.blocks) {
      const entries = getBlockEntries(slots, bandMap, block);
      for (let i = 0; i < entries.length - 1; i++) {
        totalPenalty += calculateDescendingPenalty(
          getLiveCompositionRating(entries[i].band),
          getLiveCompositionRating(entries[i + 1].band),
        );
      }
    }
    return -totalPenalty;
  },
};

const blockClosingComponent: ScoreComponent = {
  name: "blockClosing",
  weight: 1,
  calculate: (slots, context) => {
    const bandMap = new Map(context.allBands.map((b) => [b.id, b]));
    let bonus = 0;
    for (const block of context.blocks) {
      const entries = getBlockEntries(slots, bandMap, block);
      if (entries.length === 0) continue;
      bonus += calculateBlockClosingBonus(getLiveCompositionRating(entries[entries.length - 1].band));
      if (entries.length >= 2) {
        bonus += calculateBlockClosingBonus(getLiveCompositionRating(entries[entries.length - 2].band)) * 0.5;
      }
    }
    return bonus;
  },
};

export const scoreComponents: ScoreComponent[] = [
  positionRatingComponent,
  descendingPenaltyComponent,
  blockClosingComponent,
];

export function evaluateSchedule(slots: TimetableSlot[], context: ScheduleContext): number {
  return scoreComponents.reduce((total, component) => total + component.weight * component.calculate(slots, context), 0);
}

export function evaluateScheduleBreakdown(slots: TimetableSlot[], context: ScheduleContext): Record<string, number> {
  const breakdown: Record<string, number> = {};
  for (const component of scoreComponents) {
    breakdown[component.name] = component.weight * component.calculate(slots, context);
  }
  return breakdown;
}

// ---------- Debug / failure reporting ------------------------------------

export type SchedulingFailureType =
  | "NO_VALID_SCHEDULE"
  | "BLOCK_CONCENTRATION_CONFLICT"
  | "CONSECUTIVE_APPEARANCE_CONFLICT"
  | "TIME_CONSTRAINT_CONFLICT";

export type SchedulingFailure = {
  type: SchedulingFailureType;
  message: string;
  affectedPersonIds?: string[];
  affectedBandIds?: string[];
};

export type SchedulingDebugResult = {
  hardConstraintsValid: boolean;
  totalScore: number;
  scoreBreakdown: {
    positionRatingScore: number;
    descendingPenalty: number;
    blockClosingBonus: number;
  };
  personDistribution: PersonAppearanceDistribution[];
  violations: string[];
  failures: SchedulingFailure[];
};

// Admin/developer-only — never rendered in any general-user-facing view.
// Callers decide where (if anywhere) to surface this; see useAppStore.ts's
// autoScheduleAllDays, which only console.debug()s it in dev builds.
export function buildSchedulingDebugResult(
  slots: TimetableSlot[],
  context: ScheduleContext,
  failures: SchedulingFailure[] = [],
): SchedulingDebugResult {
  const validation = validateHardConstraints(slots, context);
  const positionRatingScore = positionRatingComponent.weight * positionRatingComponent.calculate(slots, context);
  const descendingPenalty = descendingPenaltyComponent.weight * descendingPenaltyComponent.calculate(slots, context);
  const blockClosingBonus = blockClosingComponent.weight * blockClosingComponent.calculate(slots, context);
  return {
    hardConstraintsValid: validation.isValid,
    totalScore: positionRatingScore + descendingPenalty + blockClosingBonus,
    scoreBreakdown: { positionRatingScore, descendingPenalty, blockClosingBonus },
    personDistribution: computePersonAppearanceDistribution(slots, context.allBands, context.blocks),
    violations: validation.violations.map((v) => v.message),
    failures,
  };
}

const VIOLATION_TYPE_TO_FAILURE_TYPE: Record<HardConstraintViolationType, SchedulingFailureType> = {
  TIME_CONSTRAINT: "TIME_CONSTRAINT_CONFLICT",
  CONSECUTIVE_APPEARANCE: "CONSECUTIVE_APPEARANCE_CONFLICT",
  BLOCK_CONCENTRATION: "BLOCK_CONCENTRATION_CONFLICT",
};

function buildFailureMessage(type: SchedulingFailureType, bandNames: string[]): string {
  const names = bandNames.join("、") || "一部のバンド";
  switch (type) {
    case "TIME_CONSTRAINT_CONFLICT":
      return `出演可能時間の制約を満たせず、${names} を未配置のままにしました`;
    case "CONSECUTIVE_APPEARANCE_CONFLICT":
      return `同一人物の連続出演を避けられず、${names} を未配置のままにしました`;
    case "BLOCK_CONCENTRATION_CONFLICT":
      return `同一人物のブロック集中制限（同一ブロック最大ceil(N/2)回）を満たせず、${names} を未配置のままにしました`;
    case "NO_VALID_SCHEDULE":
    default:
      return `制約をすべて満たす配置が見つからず、${names} を未配置のままにしました`;
  }
}

function pickSlotToRemove(violations: HardConstraintViolation[]): string | null {
  const freq = new Map<string, number>();
  for (const v of violations) {
    for (const slotId of v.slotIds) freq.set(slotId, (freq.get(slotId) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [slotId, count] of freq) {
    if (count > bestCount) {
      best = slotId;
      bestCount = count;
    }
  }
  return best;
}

// Step 1's safety net. If the annealing search below still leaves its best
// arrangement with hard-constraint violations — e.g. a day where physically
// no full placement can satisfy every constraint at once (too few blocks,
// a time window only one block can ever satisfy, or some combination of
// constraints with no joint solution) — this never returns an invalid
// schedule. It repeatedly drops the single band most implicated across all
// remaining violations, re-validates, and repeats, the same "genuinely
// infeasible bands stay unplaced" philosophy this module already used for
// time-eligibility alone, now covering every hard constraint. Every
// removed band is reported back as a SchedulingFailure instead of
// disappearing silently — see this feature's "ブロック数不足時の扱い"
// requirement.
function pruneToValidSchedule(
  slots: TimetableSlot[],
  context: ScheduleContext,
): { slots: TimetableSlot[]; failures: SchedulingFailure[] } {
  let current = slots;
  const byFailureType = new Map<SchedulingFailureType, { bandIds: Set<string>; personIds: Set<string> }>();
  const bandMap = new Map(context.allBands.map((b) => [b.id, b]));
  const maxAttempts = current.filter((s) => s.bandId).length;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = validateHardConstraints(current, context);
    if (result.isValid) break;

    const slotId = pickSlotToRemove(result.violations);
    if (!slotId) break;
    const slot = current.find((s) => s.id === slotId);
    const bandId = slot?.bandId;
    if (!bandId) break;

    for (const v of result.violations) {
      if (!v.slotIds.includes(slotId)) continue;
      const failureType = VIOLATION_TYPE_TO_FAILURE_TYPE[v.type];
      const entry = byFailureType.get(failureType) ?? { bandIds: new Set<string>(), personIds: new Set<string>() };
      entry.bandIds.add(bandId);
      v.personIds?.forEach((p) => entry.personIds.add(p));
      byFailureType.set(failureType, entry);
    }

    current = recomputeTimes(
      current.map((s) => (s.id === slotId ? { ...s, bandId: null } : s)),
      context.day.settings,
      context.allBands,
    );
  }

  const failures: SchedulingFailure[] = [...byFailureType].map(([type, { bandIds, personIds }]) => ({
    type,
    message: buildFailureMessage(type, [...bandIds].map((id) => bandMap.get(id)?.name ?? id)),
    affectedBandIds: [...bandIds],
    affectedPersonIds: [...personIds],
  }));

  return { slots: current, failures };
}

// ---------- Step 1: initial hard-constraint-satisfying placement ---------

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Bounded so a single solve() call can't noticeably stall the UI even for
// an unusually large day — within the 1000–5000 range this feature was
// scoped to. Each iteration is O(slot count), so even the top of that
// range stays well under real-time budgets for any timetable someone
// would actually build by hand.
const MAX_ITERATIONS = 1500;

// Fills `day`'s empty performance slots with `candidateBands` (expected to
// be the same length — the caller's balancing pass sizes them to match,
// but this clamps defensively if not) by searching for a *hard-constraint
// violation count* of zero via simulated annealing — never a blended
// score. Any violations still present in the best arrangement found are
// resolved by pruneToValidSchedule, which pulls the offending bands back
// out rather than force-placing them (reported via the returned
// `failures`), the same way a manual placement attempt would refuse an
// infeasible drop.
export function solveDayAssignment(
  day: TimetableDay,
  candidateBands: Band[],
  allBands: Band[],
  venueHours: VenueHours,
): { slots: TimetableSlot[]; failures: SchedulingFailure[] } {
  const emptyPositions = day.slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot.bandId === null && slot.customLabel === null)
    .map(({ index }) => index);

  if (emptyPositions.length === 0 || candidateBands.length === 0) {
    return { slots: day.slots, failures: [] };
  }

  const n = Math.min(emptyPositions.length, candidateBands.length);
  const positions = emptyPositions.slice(0, n);
  const pool = candidateBands.slice(0, n);
  const blocks = computeScheduleBlocks(day.slots);
  const context: ScheduleContext = { day, allBands, venueHours, blocks };

  function buildSlots(order: Band[]): TimetableSlot[] {
    const slots = [...day.slots];
    positions.forEach((slotIndex, i) => {
      slots[slotIndex] = { ...slots[slotIndex], bandId: order[i].id };
    });
    return recomputeTimes(slots, day.settings, allBands);
  }

  function countViolations(slots: TimetableSlot[]): number {
    return validateHardConstraints(slots, context).violations.length;
  }

  let current = shuffle(pool);
  let currentSlots = buildSlots(current);
  let currentViolations = countViolations(currentSlots);
  let best = current;
  let bestViolations = currentViolations;

  for (let iter = 0; iter < MAX_ITERATIONS && n > 1 && bestViolations > 0; iter++) {
    const i = Math.floor(Math.random() * n);
    let j = Math.floor(Math.random() * n);
    if (j === i) j = (j + 1) % n;

    const candidate = [...current];
    [candidate[i], candidate[j]] = [candidate[j], candidate[i]];
    const candidateSlots = buildSlots(candidate);
    const candidateViolations = countViolations(candidateSlots);

    const delta = candidateViolations - currentViolations;
    const temperature = 1 - iter / MAX_ITERATIONS;
    if (delta <= 0 || Math.random() < Math.exp(-delta / (temperature + 0.05))) {
      current = candidate;
      currentViolations = candidateViolations;
      if (currentViolations < bestViolations) {
        best = current;
        bestViolations = currentViolations;
      }
    }
  }

  const bestSlots = buildSlots(best);
  return pruneToValidSchedule(bestSlots, context);
}

// ---------- Step 3: ライブ構成評価による局所探索 ---------------------------
//
// Takes Step 1's (already hard-constraint-valid) output and looks for
// slot-to-slot swaps, within blocks or across them, that improve
// evaluateSchedule — but only ever moves between fully valid states.
// Deterministic (no Math.random anywhere here) so the same input always
// produces the same output, unlike Step 1's simulated annealing.
const MAX_COMPOSITION_PASSES = 20;

export function improveDayByLiveComposition(day: TimetableDay, bands: Band[], venueHours: VenueHours): TimetableSlot[] {
  const blocks = computeScheduleBlocks(day.slots);
  const context: ScheduleContext = { day, allBands: bands, venueHours, blocks };

  const performanceIndices = day.slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot.customLabel === null)
    .map(({ index }) => index);
  const filledPositions = performanceIndices.filter((i) => day.slots[i].bandId !== null);
  if (filledPositions.length < 2) return day.slots;

  // Step 1 is responsible for handing this a hard-constraint-valid
  // schedule (via its own pruneToValidSchedule safety net) — if it
  // somehow didn't, this step must not pretend to fix that by searching
  // from an invalid starting point.
  if (!isValidSchedule(day.slots, context)) return day.slots;

  let slots = day.slots;
  let currentScore = evaluateSchedule(slots, context);

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

        // Every candidate is fully re-validated against all three hard
        // constraints — an improving score never overrides an invalid
        // result.
        if (!isValidSchedule(recomputed, context)) continue;

        const candidateScore = evaluateSchedule(recomputed, context);
        if (candidateScore <= currentScore) continue;

        slots = recomputed;
        currentScore = candidateScore;
        improved = true;
      }
    }
  }

  return slots;
}
