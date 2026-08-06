import type { Band, TimetableDay, TimetableSlot } from "../types";
import type { VenueHours } from "./parseBands";
import { canPlaceBandInSlot } from "./scheduleEligibility";
import { alignTimeToReference, recomputeTimes } from "./scheduleTimes";
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

// The read-only context every hard/soft check needs. `blocks` and
// `eventStartMinutes` are computed once from the day's slot *structure*
// (divider positions and the day's own start time never move during a
// search — only which band occupies which already-existing performance
// slot changes), so both are safe to reuse across an entire search rather
// than recomputing them every candidate. `eventStartMinutes` is NOT the
// day's *end* — the end shifts with band durations as swaps happen, so
// it's recomputed per-candidate from the actual `slots` being scored (see
// computeEventTimeRange) rather than cached here.
export type ScheduleContext = {
  day: TimetableDay;
  allBands: Band[];
  venueHours: VenueHours;
  blocks: ScheduleBlock[];
  eventStartMinutes: number;
};

// Builds the context once per day/search — the one place that assembles
// `blocks` and `eventStartMinutes` together, so solveDayAssignment,
// improveDayByLiveComposition, and the debug builder never construct this
// object by hand differently from one another.
export function buildScheduleContext(day: TimetableDay, allBands: Band[], venueHours: VenueHours): ScheduleContext {
  return {
    day,
    allBands,
    venueHours,
    blocks: computeScheduleBlocks(day.slots),
    eventStartMinutes: timeToMinutes(day.settings.startTime),
  };
}

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

// A slot at index N-1 (the block's last) gets the full closing bonus; N-2
// (second-to-last) gets half; everything else gets none. Shared by
// blockClosingComponent and the debug builder so "who counts as the
// block's closer" is defined in exactly one place.
export function getClosingPositionMultiplier(index: number, totalSlots: number): number {
  if (index === totalSlots - 1) return 1;
  if (index === totalSlots - 2) return 0.5;
  return 0;
}

// ---------- Global timeline + 終盤補正 -------------------------------------
//
// Everything above scores a band's position *within its own block* only.
// That alone under-serves a late block: block-local position 0 (a perfect
// fit for a rating-1 band, by that measure alone) can still land well
// into the back half of the live event's actual running time once you
// count every block before it. The functions below score a band's
// position across the WHOLE day instead, so the two layers combine (see
// SCORE_WEIGHTS below) — a rating-1 band placed at the front of a late
// block now scores well block-locally but poorly on the global axis, and
// the global axis is what actually catches it.
export const FINAL_PHASE_DURATION_MINUTES = 180;

// slot.startTime/endTime are wall-clock "HH:MM" strings that wrap at
// 24:00 (see minutesToTime) — on their own they can't be ordered across a
// midnight crossing. alignTimeToReference is this codebase's one existing
// tool for resolving that ambiguity (see recomputeTimes, which uses it
// the same way): walking the slots in order, each time resolving the next
// wall-clock string to whichever absolute-minutes occurrence is nearest
// the previous slot's resolved end. `eventStartMinutes` is minute 0 of
// this absolute scale.
function computeAbsoluteMinutes(
  slots: TimetableSlot[],
  eventStartMinutes: number,
): Map<string, { start: number; end: number }> {
  const result = new Map<string, { start: number; end: number }>();
  let reference = eventStartMinutes;
  for (const slot of slots) {
    if (!slot.startTime || !slot.endTime) continue;
    const start = alignTimeToReference(slot.startTime, reference);
    const end = alignTimeToReference(slot.endTime, start);
    result.set(slot.id, { start, end });
    reference = end;
  }
  return result;
}

export type EventTimeRange = {
  eventStartMinutes: number;
  eventEndMinutes: number;
  absoluteMinutesBySlotId: Map<string, { start: number; end: number }>;
};

// Recomputed from the actual candidate `slots` being scored (never cached
// on ScheduleContext) because band durations can differ, so a swap can
// shift every slot after it — the day's real end time is a property of
// *this* candidate arrangement, not a fixed fact about the day.
export function computeEventTimeRange(slots: TimetableSlot[], eventStartMinutes: number): EventTimeRange {
  const absoluteMinutesBySlotId = computeAbsoluteMinutes(slots, eventStartMinutes);
  let eventEndMinutes = eventStartMinutes;
  for (const { end } of absoluteMinutesBySlotId.values()) {
    if (end > eventEndMinutes) eventEndMinutes = end;
  }
  return { eventStartMinutes, eventEndMinutes, absoluteMinutesBySlotId };
}

export function getGlobalNormalizedPosition(
  slotStartMinutes: number,
  eventStartMinutes: number,
  eventEndMinutes: number,
): number {
  const duration = eventEndMinutes - eventStartMinutes;
  if (duration <= 0) return 0;
  return Math.max(0, Math.min(1, (slotStartMinutes - eventStartMinutes) / duration));
}

export function calculateGlobalPositionPenalty(globalPosition: number, rating: number): number {
  return Math.abs(globalPosition - normalizeRating(rating));
}

// The final-phase window's lower bound never goes earlier than the event
// itself starts — a live event shorter than FINAL_PHASE_DURATION_MINUTES
// (2h) simply spends its entire run "in the final phase" rather than
// producing a nonsensical negative-length or pre-start window.
export function getFinalPhaseStart(eventStartMinutes: number, eventEndMinutes: number): number {
  return Math.max(eventStartMinutes, eventEndMinutes - FINAL_PHASE_DURATION_MINUTES);
}

// 0 before the final phase starts, 1 at (or past) the event's end,
// ramping linearly between — this is what keeps the final-phase bonus
// from snapping on all at once the instant a slot crosses finalPhaseStart
// (see calculateProgressiveFinalPhaseScore).
export function getFinalPhaseProgress(
  slotStartMinutes: number,
  finalPhaseStart: number,
  eventEndMinutes: number,
): number {
  if (slotStartMinutes <= finalPhaseStart) return 0;
  if (slotStartMinutes >= eventEndMinutes) return 1;
  const span = eventEndMinutes - finalPhaseStart;
  if (span <= 0) return 0;
  return (slotStartMinutes - finalPhaseStart) / span;
}

// At progress 0 (not yet in the final phase) this is always 0 regardless
// of rating — no cliff-edge jump at the boundary. Rating is re-centered
// around rating 3 (normalizeRating(3)*2-1 === 0) so the final phase
// actively rewards 4/5, actively penalizes 1/2, and stays neutral for 3 —
// as progress climbs toward 1 that push strengthens in whichever
// direction the rating already points, converging on ±1 right at the
// event's close.
export function calculateProgressiveFinalPhaseScore(rating: number, progress: number): number {
  const centeredRating = normalizeRating(rating) * 2 - 1;
  return centeredRating * progress;
}

// A second, independent, rating-5-only push toward the final phase —
// deliberately separate from calculateProgressiveFinalPhaseScore above
// (see SCORE_WEIGHTS.ratingFiveFinalPhase) since a rating-5 band should
// be pulled toward the close more insistently than "just the strongest
// case of the general 4/5 trend." Unlike the progress-based ramp above,
// this compares the slot's actual absolute position to finalPhaseStart
// directly: 0 exactly at finalPhaseStart, ramping to +8 at (or past) the
// event's end, and ramping the other direction to -8 the further before
// finalPhaseStart a rating-5 band sits — clamped both ways so an
// extremely early rating-5 placement doesn't produce an unbounded
// penalty, just a capped one. Non-rating-5 bands always score 0 here.
export function calculateRatingFiveFinalPhaseScore(
  rating: number,
  slotStartMinutes: number,
  finalPhaseStart: number,
  eventEndMinutes: number,
): number {
  if (rating !== 5) return 0;
  const finalPhaseDuration = eventEndMinutes - finalPhaseStart;
  if (finalPhaseDuration <= 0) return 0;
  const relativePosition = (slotStartMinutes - finalPhaseStart) / finalPhaseDuration;
  return Math.max(-1, Math.min(1, relativePosition)) * 8;
}

// ---------- 低評価出演者グループの前半ブロック優先 --------------------------
//
// Not a property stored on a person — computed fresh from the candidate
// `slots` being scored, every time. A person only ever counts as a
// "low-rated band group" for as long as literally every band they're
// placed in *today* is rated 1 or 2; nothing here is written back to the
// person/member themselves, and nothing here is persisted (see
// buildSchedulingDebugResult's own doc for the same rule applied to the
// whole debug result).
export type PerformerLowRatingProfile = {
  personId: string;
  displayName: string;
  bandIds: string[];
  ratings: number[];
  isLowRatedBandGroup: boolean;
};

export function isLowRatedPerformerGroup(personBandRatings: number[]): boolean {
  return personBandRatings.length >= 2 && personBandRatings.every((rating) => rating <= 2);
}

// Reuses the exact same member-identity pass computePersonAppearanceDistribution
// uses (normalizeMemberName over each placed band's `members`) rather than
// a second person-matching implementation — only the grouping differs
// (by distinct band, not by block).
export function computePerformerLowRatingProfiles(
  slots: TimetableSlot[],
  bands: Band[],
): PerformerLowRatingProfile[] {
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const byPerson = new Map<string, { displayName: string; bandIds: Set<string> }>();
  for (const slot of slots) {
    if (!slot.bandId) continue;
    const band = bandMap.get(slot.bandId);
    if (!band) continue;
    const seenInThisSlot = new Set<string>();
    for (const rawName of band.members) {
      const key = normalizeMemberName(rawName);
      if (!key || seenInThisSlot.has(key)) continue;
      seenInThisSlot.add(key);
      const entry = byPerson.get(key) ?? { displayName: rawName, bandIds: new Set<string>() };
      entry.bandIds.add(band.id);
      byPerson.set(key, entry);
    }
  }
  return [...byPerson.entries()].map(([personId, { displayName, bandIds }]) => {
    const bandIdList = [...bandIds];
    const ratings = bandIdList.map((id) => getLiveCompositionRating(bandMap.get(id)!));
    return { personId, displayName, bandIds: bandIdList, ratings, isLowRatedBandGroup: isLowRatedPerformerGroup(ratings) };
  });
}

// Only nonzero for the day's LAST block (index 2 of exactly 3) and only
// for a qualifying low-rated group — this is what makes the rule a soft
// nudge rather than a 4th hard constraint: it costs points, it never
// excludes a candidate the way validateHardConstraints does.
export function calculateLowRatedPerformerFinalBlockPenalty(
  totalBlockCount: number,
  isLowRatedGroup: boolean,
  blockIndex: number,
): number {
  if (totalBlockCount !== 3) return 0;
  if (!isLowRatedGroup) return 0;
  return blockIndex === 2 ? -4 : 0;
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

// Every weight lives here and nowhere else — adjusting the balance
// between "where in the whole day" vs "where in this block" vs "how
// smooth" vs "who closes the block" a band lands is a one-line change.
// finalPhase starts weighted heaviest since it's the most specific,
// highest-stakes signal (the last two hours of the whole event); the
// others are initial values per this feature's own spec, meant to be
// tuned against real event data rather than treated as final.
export const SCORE_WEIGHTS = {
  globalTimeline: 1,
  finalPhase: 2,
  ratingFiveFinalPhase: 3,
  blockTimeline: 1,
  smoothness: 0.5,
  blockClosing: 1,
  lowRatedPerformerDistribution: 2,
};

// Layer 1: ライブ全体の時間軸評価 — how well a band's rating matches its
// position across the WHOLE day (not just its own block). This is what
// stops a rating-1 band from parking itself at the front of a block that,
// block-locally, looks like "the start" but is actually most of the way
// through the live event.
const globalTimelineComponent: ScoreComponent = {
  name: "globalTimeline",
  weight: SCORE_WEIGHTS.globalTimeline,
  calculate: (slots, context) => {
    const bandMap = new Map(context.allBands.map((b) => [b.id, b]));
    const { eventStartMinutes, eventEndMinutes, absoluteMinutesBySlotId } = computeEventTimeRange(
      slots,
      context.eventStartMinutes,
    );
    let totalPenalty = 0;
    let count = 0;
    for (const slot of slots) {
      if (!slot.bandId) continue;
      const band = bandMap.get(slot.bandId);
      const abs = absoluteMinutesBySlotId.get(slot.id);
      if (!band || !abs) continue;
      const position = getGlobalNormalizedPosition(abs.start, eventStartMinutes, eventEndMinutes);
      totalPenalty += calculateGlobalPositionPenalty(position, getLiveCompositionRating(band));
      count++;
    }
    return count > 0 ? -totalPenalty / count : 0;
  },
};

// Layer 1b: 終了2時間前ルール — a soft, progressively-ramping bonus for
// high-rated bands the closer a slot sits to the event's actual end.
// Never a hard requirement (a band that can't physically go there due to
// its own time window just scores worse here, nothing more).
const finalPhaseComponent: ScoreComponent = {
  name: "finalPhase",
  weight: SCORE_WEIGHTS.finalPhase,
  calculate: (slots, context) => {
    const bandMap = new Map(context.allBands.map((b) => [b.id, b]));
    const { eventEndMinutes, absoluteMinutesBySlotId } = computeEventTimeRange(slots, context.eventStartMinutes);
    const finalPhaseStart = getFinalPhaseStart(context.eventStartMinutes, eventEndMinutes);
    let total = 0;
    let count = 0;
    for (const slot of slots) {
      if (!slot.bandId) continue;
      const band = bandMap.get(slot.bandId);
      const abs = absoluteMinutesBySlotId.get(slot.id);
      if (!band || !abs) continue;
      const progress = getFinalPhaseProgress(abs.start, finalPhaseStart, eventEndMinutes);
      total += calculateProgressiveFinalPhaseScore(getLiveCompositionRating(band), progress);
      count++;
    }
    return count > 0 ? total / count : 0;
  },
};

// Layer 1c: 評価5の終盤優先 — averaged only over rating-5 bands (everyone
// else always contributes exactly 0 here, so folding them into the
// denominator would just dilute the signal by however many non-5 bands
// happen to exist that day).
const ratingFiveFinalPhaseComponent: ScoreComponent = {
  name: "ratingFiveFinalPhase",
  weight: SCORE_WEIGHTS.ratingFiveFinalPhase,
  calculate: (slots, context) => {
    const bandMap = new Map(context.allBands.map((b) => [b.id, b]));
    const { eventEndMinutes, absoluteMinutesBySlotId } = computeEventTimeRange(slots, context.eventStartMinutes);
    const finalPhaseStart = getFinalPhaseStart(context.eventStartMinutes, eventEndMinutes);
    let total = 0;
    let count = 0;
    for (const slot of slots) {
      if (!slot.bandId) continue;
      const band = bandMap.get(slot.bandId);
      const abs = absoluteMinutesBySlotId.get(slot.id);
      if (!band || !abs) continue;
      const rating = getLiveCompositionRating(band);
      if (rating !== 5) continue;
      total += calculateRatingFiveFinalPhaseScore(rating, abs.start, finalPhaseStart, eventEndMinutes);
      count++;
    }
    return count > 0 ? total / count : 0;
  },
};

// Layer 2: ブロック内の時間軸評価 — unchanged in spirit from before this
// feature: within its own break-to-break block, a band's position should
// still roughly match its rating. Renamed from positionRating to
// blockTimeline to make the two-layer split explicit; the math is
// identical, just averaged over placed bands instead of summed so its
// scale stays comparable across blocks of different sizes.
const blockTimelineComponent: ScoreComponent = {
  name: "blockTimeline",
  weight: SCORE_WEIGHTS.blockTimeline,
  calculate: (slots, context) => {
    const bandMap = new Map(context.allBands.map((b) => [b.id, b]));
    let totalPenalty = 0;
    let count = 0;
    for (const block of context.blocks) {
      const entries = getBlockEntries(slots, bandMap, block);
      entries.forEach(({ band }, index) => {
        const rating = getLiveCompositionRating(band);
        const position = getNormalizedPosition(index, entries.length);
        totalPenalty += calculatePositionRatingPenalty(position, rating);
        count++;
      });
    }
    return count > 0 ? -totalPenalty / count : 0;
  },
};

// Layer 3: 評価推移の滑らかさ — same "penalize a drop, allow a rise"
// formula as before, renamed from descendingPenalty, now averaged per
// adjacent pair rather than summed.
const smoothnessComponent: ScoreComponent = {
  name: "smoothness",
  weight: SCORE_WEIGHTS.smoothness,
  calculate: (slots, context) => {
    const bandMap = new Map(context.allBands.map((b) => [b.id, b]));
    let totalPenalty = 0;
    let count = 0;
    for (const block of context.blocks) {
      const entries = getBlockEntries(slots, bandMap, block);
      for (let i = 0; i < entries.length - 1; i++) {
        totalPenalty += calculateDescendingPenalty(
          getLiveCompositionRating(entries[i].band),
          getLiveCompositionRating(entries[i + 1].band),
        );
        count++;
      }
    }
    return count > 0 ? -totalPenalty / count : 0;
  },
};

// Layer 4: ブロック終端評価 — the last (and, at half weight, second-to-
// last) slot in each block gets a bonus for a high rating. Averaged per
// non-empty block so a day with more blocks doesn't automatically score
// higher here than one with fewer.
const blockClosingComponent: ScoreComponent = {
  name: "blockClosing",
  weight: SCORE_WEIGHTS.blockClosing,
  calculate: (slots, context) => {
    const bandMap = new Map(context.allBands.map((b) => [b.id, b]));
    let totalBonus = 0;
    let blockCount = 0;
    for (const block of context.blocks) {
      const entries = getBlockEntries(slots, bandMap, block);
      if (entries.length === 0) continue;
      blockCount++;
      entries.forEach(({ band }, index) => {
        const multiplier = getClosingPositionMultiplier(index, entries.length);
        if (multiplier > 0) {
          totalBonus += calculateBlockClosingBonus(getLiveCompositionRating(band)) * multiplier;
        }
      });
    }
    return blockCount > 0 ? totalBonus / blockCount : 0;
  },
};

// Layer 5: 低評価出演者グループの前半ブロック優先 — a day-level nudge,
// not a per-slot one: it only ever engages for a 3-block day, and even
// then only for bands belonging to a "low-rated band group" person. See
// calculateLowRatedPerformerFinalBlockPenalty — deliberately capped at
// exactly one penalty per qualifying BAND (never per member), so a band
// with several such members doesn't cost more than one with just one.
const lowRatedPerformerDistributionComponent: ScoreComponent = {
  name: "lowRatedPerformerDistribution",
  weight: SCORE_WEIGHTS.lowRatedPerformerDistribution,
  calculate: (slots, context) => {
    const totalBlockCount = context.blocks.length;
    if (totalBlockCount !== 3) return 0;
    const qualifyingBandIds = new Set<string>();
    for (const profile of computePerformerLowRatingProfiles(slots, context.allBands)) {
      if (!profile.isLowRatedBandGroup) continue;
      for (const bandId of profile.bandIds) qualifyingBandIds.add(bandId);
    }
    if (qualifyingBandIds.size === 0) return 0;

    const blockIndexBySlotId = new Map<string, number>();
    context.blocks.forEach((block, idx) => block.slotIds.forEach((id) => blockIndexBySlotId.set(id, idx)));
    const blockIndexByBandId = new Map<string, number>();
    for (const slot of slots) {
      if (!slot.bandId) continue;
      const idx = blockIndexBySlotId.get(slot.id);
      if (idx !== undefined) blockIndexByBandId.set(slot.bandId, idx);
    }

    let total = 0;
    for (const bandId of qualifyingBandIds) {
      const blockIndex = blockIndexByBandId.get(bandId);
      if (blockIndex === undefined) continue;
      total += calculateLowRatedPerformerFinalBlockPenalty(totalBlockCount, true, blockIndex);
    }
    return total / qualifyingBandIds.size;
  },
};

export const scoreComponents: ScoreComponent[] = [
  globalTimelineComponent,
  finalPhaseComponent,
  ratingFiveFinalPhaseComponent,
  blockTimelineComponent,
  smoothnessComponent,
  blockClosingComponent,
  lowRatedPerformerDistributionComponent,
];

export type ScheduleScoreBreakdown = {
  globalTimelineScore: number;
  finalPhaseScore: number;
  ratingFiveFinalPhaseScore: number;
  blockTimelineScore: number;
  smoothnessScore: number;
  blockClosingScore: number;
  lowRatedPerformerDistributionScore: number;
  totalScore: number;
};

// The two-layer scoring's whole point: every layer is calculated over the
// SAME candidate `slots` and summed into one totalScore — never "pick one
// layer or the other." A rating-1 band at a late block's front scores
// well on blockTimelineScore alone but poorly on globalTimelineScore and
// finalPhaseScore, and it's the sum that Step 3's local search actually
// compares. totalScore is always exactly the sum of the other six fields
// here — nothing is computed independently of this breakdown.
export function evaluateSchedule(slots: TimetableSlot[], context: ScheduleContext): ScheduleScoreBreakdown {
  const globalTimelineScore = globalTimelineComponent.weight * globalTimelineComponent.calculate(slots, context);
  const finalPhaseScore = finalPhaseComponent.weight * finalPhaseComponent.calculate(slots, context);
  const ratingFiveFinalPhaseScore =
    ratingFiveFinalPhaseComponent.weight * ratingFiveFinalPhaseComponent.calculate(slots, context);
  const blockTimelineScore = blockTimelineComponent.weight * blockTimelineComponent.calculate(slots, context);
  const smoothnessScore = smoothnessComponent.weight * smoothnessComponent.calculate(slots, context);
  const blockClosingScore = blockClosingComponent.weight * blockClosingComponent.calculate(slots, context);
  const lowRatedPerformerDistributionScore =
    lowRatedPerformerDistributionComponent.weight * lowRatedPerformerDistributionComponent.calculate(slots, context);
  return {
    globalTimelineScore,
    finalPhaseScore,
    ratingFiveFinalPhaseScore,
    blockTimelineScore,
    smoothnessScore,
    blockClosingScore,
    lowRatedPerformerDistributionScore,
    totalScore:
      globalTimelineScore +
      finalPhaseScore +
      ratingFiveFinalPhaseScore +
      blockTimelineScore +
      smoothnessScore +
      blockClosingScore +
      lowRatedPerformerDistributionScore,
  };
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

export type SchedulingDebugSlot = {
  slotId: string;
  bandId: string;
  bandName: string;
  rating: number;
  startTime: string;
  blockId: string;
  blockIndex: number;
  globalPosition: number;
  blockPosition: number;
  isFinalPhase: boolean;
  finalPhaseProgress: number;
  performerIds: string[];
  scoreContributions: {
    globalTimeline: number;
    finalPhase: number;
    ratingFiveFinalPhase: number;
    blockTimeline: number;
    smoothness: number;
    blockClosing: number;
    lowRatedPerformerDistribution: number;
    total: number;
  };
};

export type SchedulingDebugPerformer = {
  personId: string;
  displayName: string;
  totalAppearances: number;
  appearancesByBlock: Record<string, number>;
  maxAllowedPerBlock: number;
  bandRatings: number[];
  isLowRatedBandGroup: boolean;
  appearsInFinalBlock: boolean;
};

export type SchedulingDebugResult = {
  hardConstraintsValid: boolean;
  totalScore: number;
  scoreBreakdown: Omit<ScheduleScoreBreakdown, "totalScore">;
  slots: SchedulingDebugSlot[];
  performers: SchedulingDebugPerformer[];
  violations: string[];
  warnings: string[];
  failures: SchedulingFailure[];
};

// Admin/developer-only — never rendered in any general-user-facing view,
// never written to Firestore/Realtime Database/localStorage/IndexedDB.
// Callers decide where (if anywhere) to surface this; see useAppStore.ts's
// autoScheduleAllDays, which hands it to a memory-only Zustand store (no
// persist middleware) that only the organizer-only Timetable Editor's
// "スコア詳細" modal reads. Per placed band, this shows exactly what each
// score layer contributed — the "why did this band end up here" a
// developer or organizer needs when a result looks off — reusing the
// exact same pure formula functions the scoring itself is built from
// rather than re-deriving anything.
export function buildSchedulingDebugResult(
  slots: TimetableSlot[],
  context: ScheduleContext,
  failures: SchedulingFailure[] = [],
): SchedulingDebugResult {
  const validation = validateHardConstraints(slots, context);
  const { totalScore, ...scoreBreakdown } = evaluateSchedule(slots, context);
  const bandMap = new Map(context.allBands.map((b) => [b.id, b]));
  const { eventStartMinutes, eventEndMinutes, absoluteMinutesBySlotId } = computeEventTimeRange(
    slots,
    context.eventStartMinutes,
  );
  const finalPhaseStart = getFinalPhaseStart(eventStartMinutes, eventEndMinutes);
  const totalBlockCount = context.blocks.length;

  const lowRatingProfiles = computePerformerLowRatingProfiles(slots, context.allBands);
  const lowRatingProfileByPersonId = new Map(lowRatingProfiles.map((p) => [p.personId, p]));
  const qualifyingBandIds = new Set<string>();
  for (const profile of lowRatingProfiles) {
    if (!profile.isLowRatedBandGroup) continue;
    for (const bandId of profile.bandIds) qualifyingBandIds.add(bandId);
  }

  const debugSlots: SchedulingDebugSlot[] = [];
  context.blocks.forEach((block, blockIndex) => {
    const entries = getBlockEntries(slots, bandMap, block);
    entries.forEach(({ slot, band }, index) => {
      const rating = getLiveCompositionRating(band);
      const blockPosition = getNormalizedPosition(index, entries.length);
      const abs = absoluteMinutesBySlotId.get(slot.id);
      const globalPosition = abs ? getGlobalNormalizedPosition(abs.start, eventStartMinutes, eventEndMinutes) : 0;
      const progress = abs ? getFinalPhaseProgress(abs.start, finalPhaseStart, eventEndMinutes) : 0;
      const next = entries[index + 1];
      const performerIds = [...new Set(band.members.map(normalizeMemberName).filter(Boolean))];

      const globalTimeline = -calculateGlobalPositionPenalty(globalPosition, rating) * SCORE_WEIGHTS.globalTimeline;
      const finalPhase = calculateProgressiveFinalPhaseScore(rating, progress) * SCORE_WEIGHTS.finalPhase;
      const ratingFiveFinalPhase = abs
        ? calculateRatingFiveFinalPhaseScore(rating, abs.start, finalPhaseStart, eventEndMinutes) *
          SCORE_WEIGHTS.ratingFiveFinalPhase
        : 0;
      const blockTimeline = -calculatePositionRatingPenalty(blockPosition, rating) * SCORE_WEIGHTS.blockTimeline;
      const smoothness = next
        ? -calculateDescendingPenalty(rating, getLiveCompositionRating(next.band)) * SCORE_WEIGHTS.smoothness
        : 0;
      const blockClosing =
        calculateBlockClosingBonus(rating) *
        getClosingPositionMultiplier(index, entries.length) *
        SCORE_WEIGHTS.blockClosing;
      const lowRatedPerformerDistribution = qualifyingBandIds.has(band.id)
        ? calculateLowRatedPerformerFinalBlockPenalty(totalBlockCount, true, blockIndex) *
          SCORE_WEIGHTS.lowRatedPerformerDistribution
        : 0;

      debugSlots.push({
        slotId: slot.id,
        bandId: band.id,
        bandName: band.name,
        rating,
        startTime: slot.startTime,
        blockId: block.id,
        blockIndex,
        globalPosition,
        blockPosition,
        isFinalPhase: abs ? abs.start >= finalPhaseStart : false,
        finalPhaseProgress: progress,
        performerIds,
        scoreContributions: {
          globalTimeline,
          finalPhase,
          ratingFiveFinalPhase,
          blockTimeline,
          smoothness,
          blockClosing,
          lowRatedPerformerDistribution,
          total:
            globalTimeline +
            finalPhase +
            ratingFiveFinalPhase +
            blockTimeline +
            smoothness +
            blockClosing +
            lowRatedPerformerDistribution,
        },
      });
    });
  });

  const finalBlockIndex = totalBlockCount - 1;
  const performers: SchedulingDebugPerformer[] = computePersonAppearanceDistribution(
    slots,
    context.allBands,
    context.blocks,
  ).map((distribution) => ({
    personId: distribution.personId,
    displayName: distribution.displayName,
    totalAppearances: distribution.totalAppearances,
    appearancesByBlock: distribution.appearancesByBlock,
    maxAllowedPerBlock: distribution.maxAllowedPerBlock,
    bandRatings: lowRatingProfileByPersonId.get(distribution.personId)?.ratings ?? [],
    isLowRatedBandGroup: lowRatingProfileByPersonId.get(distribution.personId)?.isLowRatedBandGroup ?? false,
    appearsInFinalBlock: (distribution.appearancesByBlock[context.blocks[finalBlockIndex]?.id ?? ""] ?? 0) > 0,
  }));

  const warnings: string[] = [];
  if (totalBlockCount === 3) {
    for (const performer of performers) {
      if (performer.isLowRatedBandGroup && performer.appearsInFinalBlock) {
        warnings.push(
          `${performer.displayName}は出演バンドすべての評価が2以下ですが、第3ブロックへの配置を回避できませんでした`,
        );
      }
    }
  }
  for (const slot of debugSlots) {
    if (slot.rating === 5 && !slot.isFinalPhase) {
      warnings.push(`評価5の${slot.bandName}が終盤（終了${FINAL_PHASE_DURATION_MINUTES}分前以降）の外に配置されています`);
    }
  }

  return {
    hardConstraintsValid: validation.isValid,
    totalScore,
    scoreBreakdown,
    slots: debugSlots,
    performers,
    violations: validation.violations.map((v) => v.message),
    warnings,
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

// A small, seedable PRNG (mulberry32) — production callers omit the seed
// (falling back to Math.random, unchanged behavior), but tests can pass
// one so "same input -> same output" is actually checkable for a search
// that's fundamentally randomized by design.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
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

export type SolveDayAssignmentOptions = {
  /** Fixes the simulated annealing's randomness. Omit in production (the
   * default, Math.random, is what's always been used); pass a fixed
   * number in tests for reproducible results. */
  seed?: number;
};

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
  options: SolveDayAssignmentOptions = {},
): { slots: TimetableSlot[]; failures: SchedulingFailure[] } {
  const emptyPositions = day.slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot.bandId === null && slot.customLabel === null)
    .map(({ index }) => index);

  if (emptyPositions.length === 0 || candidateBands.length === 0) {
    return { slots: day.slots, failures: [] };
  }

  const random = options.seed !== undefined ? mulberry32(options.seed) : Math.random;
  const n = Math.min(emptyPositions.length, candidateBands.length);
  const positions = emptyPositions.slice(0, n);
  const pool = candidateBands.slice(0, n);
  const context = buildScheduleContext(day, allBands, venueHours);

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

  let current = shuffle(pool, random);
  let currentSlots = buildSlots(current);
  let currentViolations = countViolations(currentSlots);
  let best = current;
  let bestViolations = currentViolations;

  for (let iter = 0; iter < MAX_ITERATIONS && n > 1 && bestViolations > 0; iter++) {
    const i = Math.floor(random() * n);
    let j = Math.floor(random() * n);
    if (j === i) j = (j + 1) % n;

    const candidate = [...current];
    [candidate[i], candidate[j]] = [candidate[j], candidate[i]];
    const candidateSlots = buildSlots(candidate);
    const candidateViolations = countViolations(candidateSlots);

    const delta = candidateViolations - currentViolations;
    const temperature = 1 - iter / MAX_ITERATIONS;
    if (delta <= 0 || random() < Math.exp(-delta / (temperature + 0.05))) {
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
  const context = buildScheduleContext(day, bands, venueHours);

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
  let currentScore = evaluateSchedule(slots, context).totalScore;

  // Ties are never taken (candidateScore must be strictly greater) — this
  // is also what satisfies "on a tie, prefer whatever's closest to Step
  // 1's original arrangement": a non-improving swap is simply never
  // applied, so the result never drifts further from Step 1's output than
  // an actual score improvement justifies.
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

        const candidateScore = evaluateSchedule(recomputed, context).totalScore;
        if (candidateScore <= currentScore) continue;

        slots = recomputed;
        currentScore = candidateScore;
        improved = true;
      }
    }
  }

  return slots;
}
