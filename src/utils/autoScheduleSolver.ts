import { arrayMove } from "@dnd-kit/sortable";
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

// The read-only context every hard/soft check needs. `blocks`,
// `eventStartMinutes`, and `finalPhaseStart` are all computed once from
// the day's slot *structure at context-build time* (divider positions,
// the day's own start time, and — critically — which slot is the final
// performance slot in `day` as passed in), so all three are safe to reuse
// across an entire search rather than recomputing them every candidate.
// `finalPhaseStart` in particular MUST stay fixed for the life of a
// search: see computeFinalPhaseStart's own doc for why deriving it from
// each candidate's own (possibly shifted) event end would let the
// evaluation goalpost move mid-search. `eventEndMinutes` itself is NOT
// cached here — it genuinely does shift with band durations as swaps
// happen, so globalTimelineComponent recomputes it per-candidate (see
// computeEventTimeRange).
export type ScheduleContext = {
  day: TimetableDay;
  allBands: Band[];
  venueHours: VenueHours;
  blocks: ScheduleBlock[];
  eventStartMinutes: number;
  finalPhaseStart: number;
};

// Builds the context once per day/search — the one place that assembles
// `blocks`, `eventStartMinutes`, and `finalPhaseStart` together, so
// solveDayAssignment, improveDayByLiveComposition, and the debug builder
// never construct this object by hand differently from one another.
export function buildScheduleContext(day: TimetableDay, allBands: Band[], venueHours: VenueHours): ScheduleContext {
  const eventStartMinutes = timeToMinutes(day.settings.startTime);
  return {
    day,
    allBands,
    venueHours,
    blocks: computeScheduleBlocks(day.slots),
    eventStartMinutes,
    finalPhaseStart: computeFinalPhaseStart(day.slots, eventStartMinutes),
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

// ---------- 評価5終盤集中の限定的な例外 -------------------------------------
//
// ceil(N/2) はハード制約のまま — この例外は、ブロック集中制限そのものを
// ソフト制約へ格下げするものではない。唯一の例外は「最終ブロックの終盤に
// 評価5バンド本人の出演だけが集中した」場合。判定は人物単位・ブロック単位
// で行われ、Firestoreへは何も保存しない(自動振り分け実行のたびに再計算)。
//
// 仕様A: 例外条件(3つとも)は、その(人物, ブロック)に集中している出演
// "全体"に対して課す — 「通常許容枠 + 超過分」という区分をこの判定では
// 使わない(区分は今もsortAppearancesDeterministicallyで表示用にだけ使える
// が、有効/無効の判定には一切関与しない)。理由:
//   - 評価3・評価4を含む集中(ケースA)は、全出演に評価5以外が1件でも
//     混ざっていればallAppearancesAreRatingFiveがfalseになり、無効。
//   - 評価5同士でも1件が終盤外(ケースB)はallAppearancesAreFinalPhaseが
//     false — 全出演が終盤内である必要がある。
//   - 評価5バンドの移動で別人物(例: 評価1のペア)に生じた集中(ケースC)は、
//     その"別人物"自身の全出演の評価がrating5ではないため、その人物・
//     ブロックの判定だけが独立して無効になる — 評価5バンドの移動が「原因」
//     かどうかを判定する必要がない。
//   - 連続出演禁止(ケースD)はこの例外と完全に独立した別のハード制約
//     (violatesConsecutiveAppearance)であり、この例外は一切関与しない。
export type PersonBlockAppearance = {
  personId: string;
  displayName: string;
  blockId: string;
  blockIndex: number;
  bandId: string;
  rating: number;
  slotId: string;
  slotStartMinutes: number;
  isFinalPhase: boolean;
};

export type BlockConcentrationReason =
  | "WITHIN_STANDARD_LIMIT"
  | "RATING_FIVE_FINAL_PHASE_EXCEPTION"
  | "NON_RATING_FIVE_CONCENTRATION"
  | "OUTSIDE_FINAL_BLOCK"
  | "OUTSIDE_FINAL_PHASE";

export type BlockConcentrationValidation = {
  isValid: boolean;
  standardLimit: number;
  actualCount: number;
  exceptionApplied: boolean;
  exceptionBandIds: string[];
  violatingBandIds: string[];
  reason: BlockConcentrationReason;
};

// デバッグ表示など、出演の並び順を安定させたい箇所のための決定的な並び替え
// — 開始時刻→スロットID→バンドIDの順。判定ロジック(仕様A)では使わない。
function sortAppearancesDeterministically(appearances: PersonBlockAppearance[]): PersonBlockAppearance[] {
  return [...appearances].sort(
    (a, b) =>
      a.slotStartMinutes - b.slotStartMinutes ||
      a.slotId.localeCompare(b.slotId) ||
      a.bandId.localeCompare(b.bandId),
  );
}

// 仕様A: 例外の判定基準は「超過分だけ」ではなく、そのブロックに集中している
// 出演"全体"。評価5以外が1件でも混ざっていれば(評価3・評価4を問わず)、
// またそのうち1件でも終盤外なら、集中している全出演が無効になる —
// 「通常枠+超過分」という区分自体をこの判定では使わない。
export function validatePersonBlockConcentration(
  appearances: PersonBlockAppearance[],
  totalAppearances: number,
  totalBlockCount: number,
): BlockConcentrationValidation {
  const standardLimit = Math.ceil(totalAppearances / 2);
  if (appearances.length <= standardLimit) {
    return {
      isValid: true,
      standardLimit,
      actualCount: appearances.length,
      exceptionApplied: false,
      exceptionBandIds: [],
      violatingBandIds: [],
      reason: "WITHIN_STANDARD_LIMIT",
    };
  }

  const isFinalBlock = appearances[0].blockIndex === totalBlockCount - 1;
  const allAppearancesAreRatingFive = appearances.every((a) => a.rating === 5);
  const allAppearancesAreFinalPhase = appearances.every((a) => a.isFinalPhase);

  if (isFinalBlock && allAppearancesAreRatingFive && allAppearancesAreFinalPhase) {
    return {
      isValid: true,
      standardLimit,
      actualCount: appearances.length,
      exceptionApplied: true,
      exceptionBandIds: sortAppearancesDeterministically(appearances).map((a) => a.bandId),
      violatingBandIds: [],
      reason: "RATING_FIVE_FINAL_PHASE_EXCEPTION",
    };
  }

  return {
    isValid: false,
    standardLimit,
    actualCount: appearances.length,
    exceptionApplied: false,
    exceptionBandIds: [],
    violatingBandIds: sortAppearancesDeterministically(appearances).map((a) => a.bandId),
    reason: !isFinalBlock
      ? "OUTSIDE_FINAL_BLOCK"
      : !allAppearancesAreRatingFive
        ? "NON_RATING_FIVE_CONCENTRATION"
        : "OUTSIDE_FINAL_PHASE",
  };
}

// computePersonAppearanceDistributionと同じメンバー正規化パスを再利用しつつ、
// (人物, ブロック)単位で各出演の評価・時刻・終盤判定まで持つ詳細版。
// validateHardConstraintsのブロック集中検証とデバッグ表示の両方が、この
// 一箇所だけを起点にする。
function computePersonBlockAppearances(
  slots: TimetableSlot[],
  context: ScheduleContext,
): Map<string, Map<string, PersonBlockAppearance[]>> {
  const bandMap = new Map(context.allBands.map((b) => [b.id, b]));
  const blockIndexBySlotId = new Map<string, number>();
  context.blocks.forEach((block, idx) => block.slotIds.forEach((id) => blockIndexBySlotId.set(id, idx)));
  const { absoluteMinutesBySlotId } = computeEventTimeRange(slots, context.eventStartMinutes);

  const result = new Map<string, Map<string, PersonBlockAppearance[]>>();
  for (const slot of slots) {
    if (!slot.bandId) continue;
    const band = bandMap.get(slot.bandId);
    if (!band) continue;
    const blockIndex = blockIndexBySlotId.get(slot.id);
    if (blockIndex === undefined) continue;
    const block = context.blocks[blockIndex];
    const abs = absoluteMinutesBySlotId.get(slot.id);
    const isFinalPhase = abs ? abs.start >= context.finalPhaseStart : false;
    const rating = getLiveCompositionRating(band);
    const seenInThisSlot = new Set<string>();
    for (const rawName of band.members) {
      const key = normalizeMemberName(rawName);
      if (!key || seenInThisSlot.has(key)) continue;
      seenInThisSlot.add(key);
      const byBlock = result.get(key) ?? new Map<string, PersonBlockAppearance[]>();
      const list = byBlock.get(block.id) ?? [];
      list.push({
        personId: key,
        displayName: rawName,
        blockId: block.id,
        blockIndex,
        bandId: band.id,
        rating,
        slotId: slot.id,
        slotStartMinutes: abs?.start ?? 0,
        isFinalPhase,
      });
      byBlock.set(block.id, list);
      result.set(key, byBlock);
    }
  }
  return result;
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

  // 3. 同一人物のブロック集中制限 (ceil(N/2)) — 評価5終盤集中は限定的な例外
  // (validatePersonBlockConcentrationの6条件をすべて満たす場合のみ有効)。
  const distribution = computePersonAppearanceDistribution(slots, context.allBands, context.blocks);
  const totalAppearancesByPerson = new Map(distribution.map((d) => [d.personId, d.totalAppearances]));
  const blockAppearancesByPerson = computePersonBlockAppearances(slots, context);
  for (const [personId, byBlock] of blockAppearancesByPerson) {
    const totalAppearances = totalAppearancesByPerson.get(personId) ?? 0;
    for (const appearances of byBlock.values()) {
      const result = validatePersonBlockConcentration(appearances, totalAppearances, context.blocks.length);
      if (result.isValid) continue;
      violations.push({
        type: "BLOCK_CONCENTRATION",
        message: `${appearances[0].displayName}が同一ブロックに${result.actualCount}回出演しています（上限${result.standardLimit}回）`,
        slotIds: appearances.map((a) => a.slotId),
        bandIds: result.violatingBandIds,
        personIds: [personId],
      });
    }
  }

  return { isValid: violations.length === 0, violations };
}

export function isValidSchedule(slots: TimetableSlot[], context: ScheduleContext): boolean {
  return validateHardConstraints(slots, context).violations.length === 0;
}

// ---------- 完成したタイムテーブルの判定 ------------------------------------
//
// ハード制約を満たしているだけでは「完成」とみなさない — 一部バンドが
// 未配置のまま残っていても、以前は`validateHardConstraints`だけを見ると
// 「ハード制約を満たしている」と判定されてしまっていた(未配置バンドは単に
// どの制約判定にも登場しないため)。isCompleteValidScheduleは、その両方
// (ハード制約 かつ 全バンド配置)を満たして初めてtrueになる。
export type ScheduleValidationResult = {
  hardConstraintsValid: boolean;
  allBandsAssigned: boolean;
  isCompleteValidSchedule: boolean;
  unassignedBandIds: string[];
  violations: HardConstraintViolation[];
};

export function validateCompleteSchedule(
  slots: TimetableSlot[],
  context: ScheduleContext,
  expectedBandIds: string[],
): ScheduleValidationResult {
  const hardResult = validateHardConstraints(slots, context);
  const placedBandIds = new Set(slots.filter((s) => s.bandId).map((s) => s.bandId!));
  const unassignedBandIds = expectedBandIds.filter((id) => !placedBandIds.has(id));
  const allBandsAssigned = unassignedBandIds.length === 0;
  return {
    hardConstraintsValid: hardResult.isValid,
    allBandsAssigned,
    isCompleteValidSchedule: hardResult.isValid && allBandsAssigned,
    unassignedBandIds,
    violations: hardResult.violations,
  };
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
// (3h) simply spends its entire run "in the final phase" rather than
// producing a nonsensical negative-length or pre-start window. Despite
// the parameter name, this is a generic "clamp(endpoint - duration,
// floor)" helper — computeFinalPhaseStart below reuses it verbatim,
// feeding it the final performance slot's START time instead of an event
// end, rather than duplicating the same one-line formula.
export function getFinalPhaseStart(eventStartMinutes: number, endpointMinutes: number): number {
  return Math.max(eventStartMinutes, endpointMinutes - FINAL_PHASE_DURATION_MINUTES);
}

// The final performance slot in timeline order — NOT necessarily the last
// element of `slots` (that could be a divider), and not picked by a plain
// `HH:mm` string-max (see computeAbsoluteMinutes's own doc for why that
// breaks across a midnight crossing). Filled or not: this is a timeline
// reference point, not "the last band placed."
function getFinalPerformanceSlotAbsoluteStart(slots: TimetableSlot[], eventStartMinutes: number): number | null {
  const performanceSlots = slots.filter((s) => s.customLabel === null);
  const finalSlot = performanceSlots.at(-1);
  if (!finalSlot) return null;
  return computeAbsoluteMinutes(slots, eventStartMinutes).get(finalSlot.id)?.start ?? null;
}

// 終盤開始時刻の基準 — Step 1 が生成した初期有効解(呼び出し時点の `slots`)
// における最終出演枠の"開始"時刻から3時間前。終了時刻や現在の候補配置から
// 再計算しない — buildScheduleContext がこの関数を一度だけ呼び、結果を
// ScheduleContext.finalPhaseStart として固定するので、Step 3 の探索中は
// バンドの入れ替え・挿入で最終枠の演奏時間が変わっても評価基準そのものは
// 動かない。演奏枠が1つも無い日は eventStartMinutes を返す(終盤の概念が
// 意味を持たないため)。
export function computeFinalPhaseStart(slots: TimetableSlot[], eventStartMinutes: number): number {
  const finalSlotStart = getFinalPerformanceSlotAbsoluteStart(slots, eventStartMinutes);
  if (finalSlotStart === null) return eventStartMinutes;
  return getFinalPhaseStart(eventStartMinutes, finalSlotStart);
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
    // 終盤開始時刻はcontextで固定済み(Step1の初期有効解基準) — 候補ごとに
    // 再計算しない。
    const finalPhaseStart = context.finalPhaseStart;
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
    const finalPhaseStart = context.finalPhaseStart;
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
  totalBlockCount: number;
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
  /** 最終ブロック終盤への評価5集中例外の適用状況。ブロックごとに1件 —
   * 複数ブロックで超過している(通常はあり得ないが)場合も網羅する。 */
  ratingFiveFinalConcentrationException: {
    applied: boolean;
    blockId?: string;
    bandIds: string[];
  };
  /** 例外の対象にならなかった通常のブロック集中違反(あれば)。 */
  invalidConcentrations: Array<{
    blockId: string;
    bandIds: string[];
    reason: BlockConcentrationReason;
  }>;
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
  /** Only present when this debug result was built right after a Step 3
   * search (see improveDayByLiveComposition) — absent for a standalone
   * buildSchedulingDebugResult call with no search to summarize. */
  optimizationSummary?: OptimizationSummary;
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
  optimizationSummary?: OptimizationSummary,
): SchedulingDebugResult {
  const validation = validateHardConstraints(slots, context);
  const { totalScore, ...scoreBreakdown } = evaluateSchedule(slots, context);
  const bandMap = new Map(context.allBands.map((b) => [b.id, b]));
  const { eventStartMinutes, eventEndMinutes, absoluteMinutesBySlotId } = computeEventTimeRange(
    slots,
    context.eventStartMinutes,
  );
  const finalPhaseStart = context.finalPhaseStart;
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
        totalBlockCount,
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
  const blockAppearancesByPerson = computePersonBlockAppearances(slots, context);
  const performers: SchedulingDebugPerformer[] = computePersonAppearanceDistribution(
    slots,
    context.allBands,
    context.blocks,
  ).map((distribution) => {
    const byBlock = blockAppearancesByPerson.get(distribution.personId);
    const exceptionBandIds: string[] = [];
    let exceptionBlockId: string | undefined;
    const invalidConcentrations: SchedulingDebugPerformer["invalidConcentrations"] = [];
    if (byBlock) {
      for (const [blockId, appearances] of byBlock) {
        const concentration = validatePersonBlockConcentration(appearances, distribution.totalAppearances, totalBlockCount);
        if (concentration.exceptionApplied) {
          exceptionBandIds.push(...concentration.exceptionBandIds);
          exceptionBlockId = blockId;
        } else if (!concentration.isValid) {
          invalidConcentrations.push({ blockId, bandIds: concentration.violatingBandIds, reason: concentration.reason });
        }
      }
    }
    return {
      personId: distribution.personId,
      displayName: distribution.displayName,
      totalAppearances: distribution.totalAppearances,
      appearancesByBlock: distribution.appearancesByBlock,
      maxAllowedPerBlock: distribution.maxAllowedPerBlock,
      bandRatings: lowRatingProfileByPersonId.get(distribution.personId)?.ratings ?? [],
      isLowRatedBandGroup: lowRatingProfileByPersonId.get(distribution.personId)?.isLowRatedBandGroup ?? false,
      appearsInFinalBlock: (distribution.appearancesByBlock[context.blocks[finalBlockIndex]?.id ?? ""] ?? 0) > 0,
      ratingFiveFinalConcentrationException: {
        applied: exceptionBandIds.length > 0,
        blockId: exceptionBlockId,
        bandIds: exceptionBandIds,
      },
      invalidConcentrations,
    };
  });

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
    ...(optimizationSummary ? { optimizationSummary } : {}),
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
): { slots: TimetableSlot[]; failures: SchedulingFailure[]; unplacedBandIds: string[] } {
  const emptyPositions = day.slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot.bandId === null && slot.customLabel === null)
    .map(({ index }) => index);

  if (emptyPositions.length === 0 || candidateBands.length === 0) {
    return { slots: day.slots, failures: [], unplacedBandIds: [] };
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
  const { slots: finalSlots, failures } = pruneToValidSchedule(bestSlots, context);
  const placedBandIds = new Set(finalSlots.filter((s) => s.bandId).map((s) => s.bandId!));
  const unplacedBandIds = pool.map((b) => b.id).filter((id) => !placedBandIds.has(id));
  return { slots: finalSlots, failures, unplacedBandIds };
}

// ---------- Step 3: ライブ構成評価による局所探索 ---------------------------
//
// Takes Step 1's (already hard-constraint-valid) output and searches for
// swap/insert moves that improve evaluateSchedule's totalScore — but only
// ever moves between fully valid states (every candidate is re-validated
// against all three hard constraints before it's ever compared on score).
// Deterministic when maxRuntimeMs is disabled (no Math.random anywhere in
// this section) so the same input always produces the same output, unlike
// Step 1's simulated annealing.
//
// 調査結果 (このfeature実装前の探索方式): 交換(SWAP)のみ、対象は
// bandId!==nullの全ペア(既にブロックをまたぐ全組み合わせが対象だった —
// 隣接や同一ブロック限定ではない)。各パスを2重ループで走査し、改善する
// 交換が見つかり次第その場で採用する"最初に見つかった改善"方式(best-of-
// iterationではない)。改善が0件のパスで終了、最大20パス。候補数・実行
// 時間の上限、状態重複防止、優先度付け、事前推定、最適化サマリーは
// 無かった。挿入(INSERT)移動も無かった。

// ---- 候補移動の型 (Phase 1: SWAP と INSERT のみ) --------------------------
export type SwapMove = { type: "SWAP"; firstSlotId: string; secondSlotId: string };
export type InsertMove = { type: "INSERT"; sourceSlotId: string; targetSlotId: string };
// 未配置バンドを空き枠へ割り当てる候補。SWAP/INSERTは`slots`に既に登場する
// バンドの位置だけを動かすため、まだどこにも配置されていないバンドを新しく
// 導入できるのはPLACEだけ — 全バンド配置(#9)を実現する唯一の移動タイプ。
export type PlaceMove = { type: "PLACE"; bandId: string; targetSlotId: string };
export type OptimizationMove = SwapMove | InsertMove | PlaceMove;

export type EvaluatedMove = {
  move: OptimizationMove;
  schedule: TimetableSlot[];
  evaluation: ScheduleScoreBreakdown;
  scoreDelta: number;
};

// 全出演枠ペアの交換候補 — 隣接や同一ブロックに限らず、離れたブロック間
// (例: 第1ブロックと第3ブロック)も対象にする。両方とも空き枠の組み合わせ
// は常に無意味(no-op)なので生成しない。
export function generateSwapMoves(performanceSlots: TimetableSlot[]): SwapMove[] {
  const moves: SwapMove[] = [];
  for (let i = 0; i < performanceSlots.length - 1; i++) {
    for (let j = i + 1; j < performanceSlots.length; j++) {
      if (performanceSlots[i].bandId === null && performanceSlots[j].bandId === null) continue;
      moves.push({ type: "SWAP", firstSlotId: performanceSlots[i].id, secondSlotId: performanceSlots[j].id });
    }
  }
  return moves;
}

// 1つのバンドの割り当てを別の出演枠の位置へ移し、間にある割り当てを1枠ずつ
// ずらす挿入候補。休憩・ブロック境界・出演枠数は変わらない — タイムライン
// 順に並べた出演枠のBand割り当てだけを動かす。moveSourceが空き枠の場合は
// 「何も無いものを移動する」ことになるため生成しない。
export function generateInsertMoves(performanceSlots: TimetableSlot[]): InsertMove[] {
  const moves: InsertMove[] = [];
  for (let i = 0; i < performanceSlots.length; i++) {
    if (performanceSlots[i].bandId === null) continue;
    for (let j = 0; j < performanceSlots.length; j++) {
      if (i === j) continue;
      moves.push({ type: "INSERT", sourceSlotId: performanceSlots[i].id, targetSlotId: performanceSlots[j].id });
    }
  }
  return moves;
}

// 未配置バンドを、まだ空いている出演枠へ割り当てる候補。既に埋まっている
// 枠は対象にしない(そこへ置くにはまずそのバンドを追い出す必要があり、
// それはSWAPが担当する領域) — PLACEは「空いている場所へ新しく入れる」
// ことだけに専念する、単純で決定的な候補。
export function generatePlaceMoves(performanceSlots: TimetableSlot[], unplacedBandIds: string[]): PlaceMove[] {
  if (unplacedBandIds.length === 0) return [];
  const emptySlotIds = performanceSlots.filter((s) => s.bandId === null).map((s) => s.id);
  const moves: PlaceMove[] = [];
  for (const bandId of unplacedBandIds) {
    for (const targetSlotId of emptySlotIds) {
      moves.push({ type: "PLACE", bandId, targetSlotId });
    }
  }
  return moves;
}

// 候補生成 (このfeatureのStep3全体で唯一の生成箇所) — 候補の適用・検証・
// 評価とは混在させない。unplacedBandIdsを渡すとPLACE候補も含める(呼び出し
// 側でmandatory/normalの優先度分けに使う — see improveDayByLiveComposition)。
export function generateCandidateMoves(slots: TimetableSlot[], unplacedBandIds: string[] = []): OptimizationMove[] {
  const performanceSlots = slots.filter((s) => s.customLabel === null);
  return [
    ...generatePlaceMoves(performanceSlots, unplacedBandIds),
    ...generateSwapMoves(performanceSlots),
    ...generateInsertMoves(performanceSlots),
  ];
}

function applySwapMove(slots: TimetableSlot[], move: SwapMove): TimetableSlot[] {
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const first = slotById.get(move.firstSlotId);
  const second = slotById.get(move.secondSlotId);
  if (!first || !second) return slots;
  return slots.map((s) => {
    if (s.id === first.id) return { ...s, bandId: second.bandId };
    if (s.id === second.id) return { ...s, bandId: first.bandId };
    return s;
  });
}

function applyPlaceMove(slots: TimetableSlot[], move: PlaceMove): TimetableSlot[] {
  return slots.map((s) => (s.id === move.targetSlotId && s.bandId === null ? { ...s, bandId: move.bandId } : s));
}

// arrayMove (既存依存の@dnd-kit/sortable、新規依存の追加なし) を使い、
// タイムライン順の出演枠配列の中でsourceの割り当てをtargetの位置へ移し、
// 間の割り当てだけを1枠ずつずらす。非バンド枠(休憩など)はそもそも
// performanceSlotsの対象外なので動かない。
function applyInsertMove(slots: TimetableSlot[], move: InsertMove): TimetableSlot[] {
  const performanceSlots = slots.filter((s) => s.customLabel === null);
  const ids = performanceSlots.map((s) => s.id);
  const sourceIndex = ids.indexOf(move.sourceSlotId);
  const targetIndex = ids.indexOf(move.targetSlotId);
  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return slots;
  const bandIds = performanceSlots.map((s) => s.bandId);
  const reordered = arrayMove(bandIds, sourceIndex, targetIndex);
  const bandIdByPosition = new Map(ids.map((id, i) => [id, reordered[i]]));
  return slots.map((s) => (bandIdByPosition.has(s.id) ? { ...s, bandId: bandIdByPosition.get(s.id) ?? null } : s));
}

// 候補適用 (このfeatureのStep3全体で唯一の適用箇所) — ハード制約検証や
// スコア評価とは混在させない。recomputeTimesは常に適用後に一度だけ呼ぶ。
export function applyOptimizationMove(
  slots: TimetableSlot[],
  move: OptimizationMove,
  day: TimetableDay,
  bands: Band[],
): TimetableSlot[] {
  const next =
    move.type === "SWAP" ? applySwapMove(slots, move) : move.type === "INSERT" ? applyInsertMove(slots, move) : applyPlaceMove(slots, move);
  return recomputeTimes(next, day.settings, bands);
}

// 固定された出演枠とBand割り当てから状態キーを生成する — 同じ割り当てなら
// recomputeTimesも常に同じ時刻を返す(day.settings/bandsに対する純関数)ため、
// 時刻情報を追加する必要はない。休憩など非バンド枠はキーに含めない(常に
// 不変のため)。
export function createScheduleStateKey(slots: TimetableSlot[], dayId: string): string {
  return slots
    .filter((s) => s.customLabel === null)
    .map((s) => `${dayId}:${s.id}:${s.bandId ?? "EMPTY"}`)
    .join("|");
}

// 候補評価 (このfeatureのStep3全体で唯一の評価箇所) — ハード制約に違反する
// 場合はnullを返す。既存のisValidSchedule/evaluateScheduleを再利用するのみで、
// 制約ロジックやスコアロジックを複製しない。
export function evaluateOptimizationMove(
  slots: TimetableSlot[],
  move: OptimizationMove,
  day: TimetableDay,
  bands: Band[],
  context: ScheduleContext,
  currentTotalScore: number,
): EvaluatedMove | null {
  const candidate = applyOptimizationMove(slots, move, day, bands);
  if (!isValidSchedule(candidate, context)) return null;
  const evaluation = evaluateSchedule(candidate, context);
  return { move, schedule: candidate, evaluation, scoreDelta: evaluation.totalScore - currentTotalScore };
}

// ---- 問題枠の優先探索と事前推定 -------------------------------------------

export const PRIORITY_NEGATIVE_SCORE_THRESHOLD = -5;

// 改善可能性が高い枠を含む候補を優先するための判定 — 優先対象外の候補を
// 完全に禁止するわけではない(rankAndLimitCandidateMovesが並び替えに使う
// だけで、除外はしない)。
export function isPriorityOptimizationTarget(slot: SchedulingDebugSlot): boolean {
  return (
    (slot.rating === 5 && !slot.isFinalPhase) ||
    (slot.blockIndex === slot.totalBlockCount - 1 && slot.rating <= 2) ||
    slot.scoreContributions.total <= PRIORITY_NEGATIVE_SCORE_THRESHOLD
  );
}

// 簡易的な改善見込み — globalTimeline/finalPhase/blockTimelineという、
// 直前に計算済みのdebugResult上の位置情報(globalPosition/blockPosition/
// finalPhaseProgress)だけから安価に再計算できる項目に限定する。
// smoothness/blockClosing/lowRatedPerformerDistributionは隣接枠や
// グループ情報が必要で安価に見積もれないため、推定では0として扱う —
// 並び替え・絞り込みにしか使わないため、最終判定(evaluateOptimizationMove)
// の正確さには影響しない。
function estimateSlotContributionForRating(slot: SchedulingDebugSlot, rating: number): number {
  const globalTimeline = -calculateGlobalPositionPenalty(slot.globalPosition, rating) * SCORE_WEIGHTS.globalTimeline;
  const finalPhase = calculateProgressiveFinalPhaseScore(rating, slot.finalPhaseProgress) * SCORE_WEIGHTS.finalPhase;
  const blockTimeline = -calculatePositionRatingPenalty(slot.blockPosition, rating) * SCORE_WEIGHTS.blockTimeline;
  return globalTimeline + finalPhase + blockTimeline;
}

// このモジュール内でSWAP/INSERT/PLACEそれぞれの対象スロットIDを取り出す
// 唯一の場所 — estimateMoveScoreDelta・moveTieBreakKey・rankAndLimitCandidateMoves
// の3箇所が同じロジックを複製しないようにする。PLACEはtargetSlotIdだけが
// 実在のスロットID(bandIdはスロットIDではない)。
function getMoveSlotIds(move: OptimizationMove): string[] {
  if (move.type === "SWAP") return [move.firstSlotId, move.secondSlotId];
  if (move.type === "INSERT") return [move.sourceSlotId, move.targetSlotId];
  return [move.targetSlotId];
}

export function estimateMoveScoreDelta(move: OptimizationMove, debugResult: SchedulingDebugResult): number {
  // PLACE候補は常にmandatory(件数上限の対象外)で、この見積もりは候補の
  // 並び替え・絞り込みにしか使わないため、PLACEに対しては評価しない
  // (未配置バンドの解消そのものが最優先で、推定スコアで割り込む必要がない)。
  if (move.type === "PLACE") return 0;
  const slotDebugById = new Map(debugResult.slots.map((s) => [s.slotId, s]));
  const [idA, idB] = getMoveSlotIds(move);
  const a = slotDebugById.get(idA);
  const b = slotDebugById.get(idB);
  if (!a && !b) return 0;
  const ratingA = a?.rating ?? 3;
  const ratingB = b?.rating ?? 3;
  const before = (a ? estimateSlotContributionForRating(a, ratingA) : 0) + (b ? estimateSlotContributionForRating(b, ratingB) : 0);
  const after = (a ? estimateSlotContributionForRating(a, ratingB) : 0) + (b ? estimateSlotContributionForRating(b, ratingA) : 0);
  return after - before;
}

function moveTieBreakKey(move: OptimizationMove): string {
  if (move.type === "SWAP") return `SWAP:${move.firstSlotId}:${move.secondSlotId}`;
  if (move.type === "INSERT") return `INSERT:${move.sourceSlotId}:${move.targetSlotId}`;
  return `PLACE:${move.bandId}:${move.targetSlotId}`;
}

// 候補が上限以下ならそのまま全件、超える場合は (1) 問題枠を含む候補 →
// (2) 推定改善量の降順 → (3) 安定したtieBreakKey の順で並べ、上位だけを
// 返す。省略した件数は必ずskippedCountとして呼び出し元(最適化サマリー)へ
// 伝える — 「探索を尽くした」とは扱わない。
function rankAndLimitCandidateMoves(
  moves: OptimizationMove[],
  debugResult: SchedulingDebugResult,
  maxCandidates: number,
): { candidates: OptimizationMove[]; skippedCount: number } {
  if (moves.length <= maxCandidates) return { candidates: moves, skippedCount: 0 };

  const slotDebugById = new Map(debugResult.slots.map((s) => [s.slotId, s]));
  const ranked = moves.map((move) => {
    const ids = getMoveSlotIds(move);
    const isPriority = ids.some((id) => {
      const sd = slotDebugById.get(id);
      return sd ? isPriorityOptimizationTarget(sd) : false;
    });
    return {
      move,
      isPriority,
      estimatedScoreDelta: estimateMoveScoreDelta(move, debugResult),
      tieBreakKey: moveTieBreakKey(move),
    };
  });
  ranked.sort((x, y) => {
    if (x.isPriority !== y.isPriority) return x.isPriority ? -1 : 1;
    if (x.estimatedScoreDelta !== y.estimatedScoreDelta) return y.estimatedScoreDelta - x.estimatedScoreDelta;
    return x.tieBreakKey < y.tieBreakKey ? -1 : x.tieBreakKey > y.tieBreakKey ? 1 : 0;
  });
  return { candidates: ranked.slice(0, maxCandidates).map((r) => r.move), skippedCount: ranked.length - maxCandidates };
}

// ---- 上限・停止条件・最適化サマリー ----------------------------------------

export const OPTIMIZATION_LIMITS = {
  maxIterations: 100,
  // PLACE候補(未配置バンド×空き枠、mandatoryとして無制限に評価される)を
  // 除いた、通常のSWAP/INSERT候補に対する1反復あたりの上限。300→1000。
  maxCandidatesPerIteration: 1000,
  maxRuntimeMs: 5000,
};

const MIN_IMPROVEMENT = 0.0001;

export type OptimizationOptions = {
  maxIterations?: number;
  maxCandidatesPerIteration?: number;
  /** nullで本番用の安全装置(実行時間上限)を無効化する — 決定性を検証する
   * テストは必ずnullを渡し、候補数・反復回数だけで停止させること。省略時
   * は本番既定値(OPTIMIZATION_LIMITS.maxRuntimeMs)を使う。 */
  maxRuntimeMs?: number | null;
  /** 実行時間上限のテストを実時間に依存させないための注入可能な時計。
   * 省略時はDate.now。 */
  now?: () => number;
  /** Step1がpruneToValidSchedule等で未配置のまま残したバンドID
   * (solveDayAssignmentの戻り値のunplacedBandIds)。指定すると、これらを
   * `day`の空き出演枠へ配置するPLACE候補が毎反復mandatoryとして評価され、
   * ソフト最適化より優先される。 */
  unplacedBandIds?: string[];
};

export type OptimizationMoveType = "swap" | "insert" | "place";
export type OptimizationStopReason = "NO_IMPROVING_MOVE" | "ITERATION_LIMIT" | "CANDIDATE_LIMIT" | "RUNTIME_LIMIT";
export type UnresolvedIssueType =
  | "RATING_FIVE_OUTSIDE_FINAL_PHASE"
  | "LOW_RATING_IN_FINAL_BLOCK"
  | "LOW_RATED_PERFORMER_IN_FINAL_BLOCK";
export type UnresolvedIssueReason =
  | "ALL_EVALUATED_MOVES_INVALID"
  | "NO_IMPROVING_MOVE_FOUND"
  | "CANDIDATE_LIMIT_REACHED"
  | "ITERATION_LIMIT_REACHED"
  | "RUNTIME_LIMIT_REACHED"
  | "SEARCH_NOT_EXHAUSTIVE";
export type UnresolvedIssue = {
  type: UnresolvedIssueType;
  bandIds?: string[];
  personIds?: string[];
  reason: UnresolvedIssueReason;
  message: string;
};

export type OptimizationSummary = {
  initialScore: number;
  finalScore: number;
  totalImprovement: number;
  iterationCount: number;
  candidateCount: number;
  validCandidateCount: number;
  hardConstraintViolationCount: number;
  noImprovementCount: number;
  acceptedMoveCount: number;
  skippedCandidateCount: number;
  acceptedMovesByType: Record<OptimizationMoveType, number>;
  stoppedBy: OptimizationStopReason;
  unresolvedIssues: UnresolvedIssue[];
  /** 未配置バンド数の変化 — 未配置修復(PLACE, mandatory)がソフト最適化
   * より優先されたことをここで確認できる。 */
  unassignedBandCountBefore: number;
  unassignedBandCountAfter: number;
  /** どのバンドが最終的に未配置のまま残ったか(順序は不定)。 */
  unassignedBandIds: string[];
  /** mandatoryCandidateCount(PLACE)は通常候補の件数上限に一切含まれない。 */
  mandatoryCandidateCount: number;
  isCompleteValidSchedule: boolean;
};

// 候補上限・反復上限・実行時間上限へ到達した場合、「ハード制約上不可能」
// と断定しない — 探索を尽くしていない場合はSEARCH_NOT_EXHAUSTIVE、または
// 対応する上限到達理由を使う。全run共通の1つの理由を、残っている問題すべて
// へ適用する(問題ごとに個別の探索履歴は追跡していないため)。
function pickUnresolvedReason(stats: {
  candidateCount: number;
  validCandidateCount: number;
  skippedCandidateCount: number;
  stoppedBy: OptimizationStopReason;
}): UnresolvedIssueReason {
  if (stats.candidateCount > 0 && stats.validCandidateCount === 0) return "ALL_EVALUATED_MOVES_INVALID";
  if (stats.skippedCandidateCount > 0) return "SEARCH_NOT_EXHAUSTIVE";
  if (stats.stoppedBy === "ITERATION_LIMIT") return "ITERATION_LIMIT_REACHED";
  if (stats.stoppedBy === "RUNTIME_LIMIT") return "RUNTIME_LIMIT_REACHED";
  if (stats.stoppedBy === "CANDIDATE_LIMIT") return "CANDIDATE_LIMIT_REACHED";
  return "NO_IMPROVING_MOVE_FOUND";
}

function collectUnresolvedIssues(
  debugResult: SchedulingDebugResult,
  stats: {
    candidateCount: number;
    validCandidateCount: number;
    skippedCandidateCount: number;
    stoppedBy: OptimizationStopReason;
  },
): UnresolvedIssue[] {
  const reason = pickUnresolvedReason(stats);
  const issues: UnresolvedIssue[] = [];
  for (const slot of debugResult.slots) {
    if (slot.rating === 5 && !slot.isFinalPhase) {
      issues.push({
        type: "RATING_FIVE_OUTSIDE_FINAL_PHASE",
        bandIds: [slot.bandId],
        reason,
        message: `評価5の${slot.bandName}が終盤の外に配置されています`,
      });
    }
    if (slot.blockIndex === slot.totalBlockCount - 1 && slot.rating <= 2) {
      issues.push({
        type: "LOW_RATING_IN_FINAL_BLOCK",
        bandIds: [slot.bandId],
        reason,
        message: `評価${slot.rating}の${slot.bandName}が最終ブロックに配置されています`,
      });
    }
  }
  for (const performer of debugResult.performers) {
    if (performer.isLowRatedBandGroup && performer.appearsInFinalBlock) {
      issues.push({
        type: "LOW_RATED_PERFORMER_IN_FINAL_BLOCK",
        personIds: [performer.personId],
        reason,
        message: `${performer.displayName}は出演バンドすべての評価が2以下ですが、最終ブロックに出演があります`,
      });
    }
  }
  return issues;
}

// Step 1の初期有効解を受け取り、SWAP/INSERT候補による丘登り法
// (hill-climbing)で改善する。各反復で、ハード制約を満たす候補のうち総合
// スコアが最も改善する候補を1件だけ採用する(最初に見つかった改善ではない)
// — 改善候補が無い・反復上限・実行時間上限のいずれかに達するまで繰り返す。
// 同点(改善量が等しい)候補同士は、より順序の早いtieBreakKeyを持つ方が
// ソート結果の先頭に来るため自然に優先される。ties自体は採用しない
// (MIN_IMPROVEMENTを超える改善だけを採用するため)ので、Step1からの変更が
// 最小限になる。
export function improveDayByLiveComposition(
  day: TimetableDay,
  bands: Band[],
  venueHours: VenueHours,
  options: OptimizationOptions = {},
): { slots: TimetableSlot[]; summary: OptimizationSummary } {
  const context = buildScheduleContext(day, bands, venueHours);
  const limits = {
    maxIterations: options.maxIterations ?? OPTIMIZATION_LIMITS.maxIterations,
    maxCandidatesPerIteration: options.maxCandidatesPerIteration ?? OPTIMIZATION_LIMITS.maxCandidatesPerIteration,
    maxRuntimeMs: options.maxRuntimeMs === undefined ? OPTIMIZATION_LIMITS.maxRuntimeMs : options.maxRuntimeMs,
  };
  const now = options.now ?? Date.now;
  const startTime = now();
  // 未配置バンドの修復(PLACE)は、ソフト最適化(SWAP/INSERT)より必ず先に
  // 検討される — 各反復の選定ロジック自体がこれを保証する(下記参照)。
  // 別関数・別ループとして"修復フェーズ"を切り出さず、既存のhill-climbing
  // ループへPLACEを合流させているのは、同じ探索基盤(候補生成・適用・
  // ハード制約検証・スコア評価・状態キャッシュ)を複製しないため。
  const remainingUnplacedBandIds = new Set(options.unplacedBandIds ?? []);
  const initialUnassignedBandCount = remainingUnplacedBandIds.size;
  const initiallyExpectedBandIds = [
    ...new Set([...day.slots.filter((s) => s.bandId).map((s) => s.bandId!), ...remainingUnplacedBandIds]),
  ];

  const emptySummary = (score: number, unassignedCount: number): OptimizationSummary => ({
    initialScore: score,
    finalScore: score,
    totalImprovement: 0,
    iterationCount: 0,
    candidateCount: 0,
    validCandidateCount: 0,
    hardConstraintViolationCount: 0,
    noImprovementCount: 0,
    acceptedMoveCount: 0,
    skippedCandidateCount: 0,
    acceptedMovesByType: { swap: 0, insert: 0, place: 0 },
    stoppedBy: "NO_IMPROVING_MOVE",
    unresolvedIssues: [],
    unassignedBandCountBefore: unassignedCount,
    unassignedBandCountAfter: unassignedCount,
    unassignedBandIds: [...remainingUnplacedBandIds],
    mandatoryCandidateCount: 0,
    isCompleteValidSchedule: unassignedCount === 0,
  });

  const performanceSlotCount = day.slots.filter((s) => s.customLabel === null && s.bandId !== null).length;
  // Step 1 is responsible for handing this a hard-constraint-valid
  // schedule (via its own pruneToValidSchedule safety net) — if it
  // somehow didn't, this step must not pretend to fix that by searching
  // from an invalid starting point. (An unplaced-band repair is still
  // meaningful even with < 2 filled slots, so this guard only blocks on
  // invalidity, not on having "too few" placed bands.)
  if (!isValidSchedule(day.slots, context)) {
    return { slots: day.slots, summary: emptySummary(0, initialUnassignedBandCount) };
  }
  if (performanceSlotCount < 2 && remainingUnplacedBandIds.size === 0) {
    return { slots: day.slots, summary: emptySummary(evaluateSchedule(day.slots, context).totalScore, 0) };
  }

  let slots = day.slots;
  let currentEvaluation = evaluateSchedule(slots, context);
  const initialScore = currentEvaluation.totalScore;

  // 1回のsolve実行中だけメモリ上に保持する評価キャッシュ・訪問済み状態
  // (Firestore等へは一切保存しない)。キーは同じBand割り当てなら常に同じ
  // 結果になるためcreateScheduleStateKeyのみで十分。
  const evaluationCache = new Map<string, EvaluatedMove | "INVALID">();
  let candidateCount = 0;
  let validCandidateCount = 0;
  let mandatoryCandidateCount = 0;
  let acceptedMoveCount = 0;
  let skippedCandidateCount = 0;
  const acceptedMovesByType: Record<OptimizationMoveType, number> = { swap: 0, insert: 0, place: 0 };
  let stoppedBy: OptimizationStopReason = "NO_IMPROVING_MOVE";
  let iteration = 0;

  function evaluate(move: OptimizationMove): EvaluatedMove | null {
    candidateCount++;
    // 状態キー用にcandidateSlotsを先に作る(重複評価を避けるため) —
    // キャッシュ未命中の場合、evaluateOptimizationMoveが同じ移動を
    // もう一度適用するが、この規模の日程ではコストは無視できる。
    const stateKey = createScheduleStateKey(applyOptimizationMove(slots, move, day, bands), context.day.id);
    const cached = evaluationCache.get(stateKey);
    let evaluated: EvaluatedMove | null;
    if (cached === "INVALID") {
      evaluated = null;
    } else if (cached) {
      evaluated = { ...cached, scoreDelta: cached.evaluation.totalScore - currentEvaluation.totalScore };
    } else {
      evaluated = evaluateOptimizationMove(slots, move, day, bands, context, currentEvaluation.totalScore);
      evaluationCache.set(stateKey, evaluated ?? "INVALID");
    }
    if (evaluated) validCandidateCount++;
    return evaluated;
  }

  for (; iteration < limits.maxIterations; iteration++) {
    if (limits.maxRuntimeMs !== null && now() - startTime >= limits.maxRuntimeMs) {
      stoppedBy = "RUNTIME_LIMIT";
      break;
    }

    const performanceSlots = slots.filter((s) => s.customLabel === null);

    // 必須候補 (PLACE) — 通常候補の件数上限(maxCandidatesPerIteration)の
    // 対象外。未配置バンドが残っている限り、毎反復すべて評価する。
    const mandatoryMoves = generatePlaceMoves(performanceSlots, [...remainingUnplacedBandIds]);
    mandatoryCandidateCount += mandatoryMoves.length;
    let bestPlaceMove: EvaluatedMove | null = null;
    for (const move of mandatoryMoves) {
      const evaluated = evaluate(move);
      // PLACEはスコアの正負を問わず採用対象 — 未配置バンド数を減らすこと
      // 自体が最優先(#10の辞書式優先順位)であり、ソフトスコアはPLACE同士
      // (=どのバンドをどの空き枠へ)の比較にのみ使う。
      if (evaluated && (!bestPlaceMove || evaluated.scoreDelta > bestPlaceMove.scoreDelta)) {
        bestPlaceMove = evaluated;
      }
    }

    // 通常候補 (SWAP/INSERT) — 事前推定・優先度・件数上限を適用。
    const normalMoves = [...generateSwapMoves(performanceSlots), ...generateInsertMoves(performanceSlots)];
    const debugResult = buildSchedulingDebugResult(slots, context);
    const { candidates: rankedNormalMoves, skippedCount } = rankAndLimitCandidateMoves(
      normalMoves,
      debugResult,
      limits.maxCandidatesPerIteration,
    );
    skippedCandidateCount += skippedCount;

    let bestOtherMove: EvaluatedMove | null = null;
    // PLACEで解決できる反復では、SWAP/INSERTを評価するまでもなく必ず
    // PLACEが選ばれる(下記の選定ロジック)ので、無駄な評価をしない。
    if (!bestPlaceMove) {
      for (const move of rankedNormalMoves) {
        const evaluated = evaluate(move);
        if (evaluated && evaluated.scoreDelta > MIN_IMPROVEMENT && (!bestOtherMove || evaluated.scoreDelta > bestOtherMove.scoreDelta)) {
          bestOtherMove = evaluated;
        }
      }
    }

    // 辞書式優先順位: (1) 未配置バンドを減らす候補(PLACE)を常に優先 —
    // (2) それが無い反復に限り、ソフトスコアを最も改善するSWAP/INSERTを
    // 採用する。
    const bestMove = bestPlaceMove ?? bestOtherMove;
    if (!bestMove) {
      stoppedBy = "NO_IMPROVING_MOVE";
      break;
    }

    slots = bestMove.schedule;
    currentEvaluation = bestMove.evaluation;
    acceptedMoveCount++;
    if (bestMove.move.type === "PLACE") {
      acceptedMovesByType.place++;
      remainingUnplacedBandIds.delete(bestMove.move.bandId);
    } else {
      acceptedMovesByType[bestMove.move.type === "SWAP" ? "swap" : "insert"]++;
    }
  }
  if (iteration >= limits.maxIterations) stoppedBy = "ITERATION_LIMIT";

  const finalDebug = buildSchedulingDebugResult(slots, context);
  const searchStats = { candidateCount, validCandidateCount, skippedCandidateCount, stoppedBy };
  const completeValidation = validateCompleteSchedule(slots, context, initiallyExpectedBandIds);
  const summary: OptimizationSummary = {
    initialScore,
    finalScore: currentEvaluation.totalScore,
    totalImprovement: currentEvaluation.totalScore - initialScore,
    iterationCount: iteration,
    candidateCount,
    validCandidateCount,
    hardConstraintViolationCount: candidateCount - validCandidateCount,
    noImprovementCount: validCandidateCount - acceptedMoveCount,
    acceptedMoveCount,
    skippedCandidateCount,
    acceptedMovesByType,
    stoppedBy,
    unresolvedIssues: collectUnresolvedIssues(finalDebug, searchStats),
    unassignedBandCountBefore: initialUnassignedBandCount,
    unassignedBandCountAfter: remainingUnplacedBandIds.size,
    unassignedBandIds: completeValidation.unassignedBandIds,
    mandatoryCandidateCount,
    isCompleteValidSchedule: completeValidation.isCompleteValidSchedule,
  };

  return { slots, summary };
}
