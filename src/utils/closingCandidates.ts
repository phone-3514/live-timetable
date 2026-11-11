import type { Band, TimetableDay, TimetableSlot } from "../types";
import type { VenueHours } from "./parseBands";
import { canPlaceBandInSlot } from "./scheduleEligibility";
import { findMemberConstraintViolations, TIME_RESTRICTION_BUFFER_MINUTES } from "./memberConstraints";
import { getLiveCompositionRating } from "./liveCompositionRating";
import { buildSwappedDays, describeWarning } from "./bandSwap";
import {
  buildScheduleContext,
  computeScheduleBlocks,
  validateHardConstraints,
  type HardConstraintViolation,
} from "./autoScheduleSolver";

// 「トリ候補」— 日時指定などの絶対ハード制約を満たしたうえで、ある日のトリ
// (最終演奏枠)に置けるバンドの一覧。
//
// 区分:
//   ・除外(excluded): 出演可能日・NG時間・希望時間・メンバー/バンドの時間指定
//     (理由メモ)のどれかに、その枠が反していて置けない。判定は手動配置と同じ
//     canPlaceBandInSlot をそのまま使う(ルールをここで複製しない)。
//   ・警告つき(warn): 置けるが、(a) 指定から20分の余裕を取ると収まらない
//     (自動振り分けは入れない)、(b) 置くと前後と同一メンバーが連続出演・同一
//     ブロックに出演が集中する、(c) 入替になる現トリがその枠に入れない。
//   ・OK: 上のどれにも当たらない。

export type ClosingSlotOption = {
  slotId: string;
  /** "トリ（最終枠）" / "ブロック2の最後" */
  label: string;
  isFinal: boolean;
  startTime: string;
  endTime: string;
  bandId: string | null;
};

/** 各ブロック(休憩などで区切られた演奏のかたまり)の最後の演奏枠。最後のものが
 * その日のトリ。 */
export function listClosingSlots(day: TimetableDay): ClosingSlotOption[] {
  const blocks = computeScheduleBlocks(day.slots);
  const byId = new Map(day.slots.map((s) => [s.id, s]));
  const options: ClosingSlotOption[] = [];
  blocks.forEach((block, index) => {
    const slot = byId.get(block.slotIds[block.slotIds.length - 1]);
    if (!slot) return;
    const isFinal = index === blocks.length - 1;
    options.push({
      slotId: slot.id,
      label: isFinal ? "トリ（最終枠）" : `ブロック${index + 1}の最後（休憩前など）`,
      isFinal,
      startTime: slot.startTime,
      endTime: slot.endTime,
      bandId: slot.bandId,
    });
  });
  return options;
}

export type ClosingCandidatePlacement = { dayLabel: string; startTime: string };

export type ClosingCandidate = {
  band: Band;
  status: "ok" | "warn" | "excluded";
  /** 置けない理由(excluded のとき) */
  blockers: string[];
  /** 置けるが気をつけたい点(warn のとき) */
  warnings: string[];
  /** いま別の枠に配置済みならその場所 */
  placement: ClosingCandidatePlacement | null;
  isCurrentClosing: boolean;
  /** 配置済みのバンドをトリに置くと現トリと入れ替えになるが、現トリが相手の枠に
   * 入れないため入替できない(swapSlotBands が無視する)。 */
  swapBlocked: boolean;
  rating: number;
};

function violationKey(v: HardConstraintViolation): string {
  return `${v.type}|${v.slotIds.join(",")}|${(v.personIds ?? []).join(",")}`;
}

function bandsWithoutConstraints(band: Band): Band {
  return { ...band, members: [], ngTime: "", desiredTime: "", timeReasonNote: undefined };
}

export function explainBlockers(
  band: Band,
  day: TimetableDay,
  slot: TimetableSlot,
  venueHours: VenueHours,
  /** 0: 時間指定に反している理由。>0: 指定には収まっているが前後この分数の余裕が
   * 取れていない理由(「ぎりぎり」の説明)。 */
  bufferMinutes = 0,
): string[] {
  const reasons: string[] = [];
  const margin = bufferMinutes > 0;
  const opts = { bufferMinutes };
  if (!margin && band.allowedDayIds.length > 0 && !band.allowedDayIds.includes(day.id)) {
    reasons.push(`${day.label}は出演可能日に入っていません`);
    return reasons;
  }
  const bare = bandsWithoutConstraints(band);
  if (!canPlaceBandInSlot({ ...bare, ngTime: band.ngTime }, day, slot, venueHours, opts)) {
    reasons.push(
      margin
        ? `NG時間「${band.ngTime.trim()}」まで${bufferMinutes}分未満です`
        : `NG時間「${band.ngTime.trim()}」にかかります`,
    );
  }
  if (!canPlaceBandInSlot({ ...bare, desiredTime: band.desiredTime }, day, slot, venueHours, opts)) {
    reasons.push(
      margin
        ? `希望時間「${band.desiredTime.trim()}」の端から${bufferMinutes}分未満です`
        : `希望時間「${band.desiredTime.trim()}」から外れます`,
    );
  }
  if (!canPlaceBandInSlot({ ...bare, timeReasonNote: band.timeReasonNote }, day, slot, venueHours, opts)) {
    reasons.push(
      margin
        ? `バンドの時間指定メモ「${(band.timeReasonNote ?? "").trim()}」の端から${bufferMinutes}分未満です`
        : `バンドの時間指定メモ「${(band.timeReasonNote ?? "").trim()}」に反します`,
    );
  }
  const people = findMemberConstraintViolations(band, day, slot, venueHours, bufferMinutes);
  if (people.length > 0) {
    reasons.push(
      margin
        ? `${people.join("・")}の時間指定（出演不可）まで${bufferMinutes}分未満です`
        : `${people.join("・")}の時間指定（出演不可）に反します`,
    );
  }
  if (reasons.length === 0) reasons.push(margin ? `時間指定まで${bufferMinutes}分未満です` : "時間指定に反します");
  return reasons;
}

/** `slotId`(トリ枠)に置けるかを、全バンドについて判定する。並びは
 * OK → 警告つき → 除外、同じ区分の中では評価の高い順・名前順。 */
export function evaluateClosingCandidates(
  days: TimetableDay[],
  dayId: string,
  slotId: string,
  bands: Band[],
  venueHours: VenueHours,
): ClosingCandidate[] {
  const day = days.find((d) => d.id === dayId);
  const slot = day?.slots.find((s) => s.id === slotId);
  if (!day || !slot) return [];

  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const currentBand = slot.bandId ? bandMap.get(slot.bandId) ?? null : null;

  // bandId -> where it sits now
  const located = new Map<string, { day: TimetableDay; slot: TimetableSlot }>();
  for (const d of days) {
    for (const s of d.slots) {
      if (s.bandId && s.customLabel === null) located.set(s.bandId, { day: d, slot: s });
    }
  }

  // Violations that exist before any change, per day, so only what a candidate
  // would newly cause is reported.
  const baselineKeys = new Map<string, Set<string>>();
  function baselineFor(d: TimetableDay): Set<string> {
    let keys = baselineKeys.get(d.id);
    if (!keys) {
      const ctx = buildScheduleContext(d, bands, venueHours);
      keys = new Set(validateHardConstraints(d.slots, ctx).violations.map(violationKey));
      baselineKeys.set(d.id, keys);
    }
    return keys;
  }

  const results: ClosingCandidate[] = [];
  for (const band of bands) {
    const here = located.get(band.id) ?? null;
    const isCurrentClosing = currentBand?.id === band.id;
    const placement: ClosingCandidatePlacement | null =
      here && !isCurrentClosing ? { dayLabel: here.day.label, startTime: here.slot.startTime } : null;
    const base = { band, placement, isCurrentClosing, swapBlocked: false, rating: getLiveCompositionRating(band) };

    if (!canPlaceBandInSlot(band, day, slot, venueHours)) {
      results.push({ ...base, status: "excluded", blockers: explainBlockers(band, day, slot, venueHours), warnings: [] });
      continue;
    }

    const warnings: string[] = [];
    let swapBlocked = false;
    if (!canPlaceBandInSlot(band, day, slot, venueHours, { bufferMinutes: TIME_RESTRICTION_BUFFER_MINUTES })) {
      warnings.push(`時間指定から${TIME_RESTRICTION_BUFFER_MINUTES}分の余裕を取ると収まりません（自動振り分けでは入りません）`);
    }

    if (!isCurrentClosing) {
      // The change this candidate stands for: swap with the band now at its
      // spot, or — if it isn't placed — take the トリ枠 over.
      let nextDays: TimetableDay[];
      const changed = new Set<string>([slot.id]);
      if (here) {
        nextDays = buildSwappedDays(days, slot.id, here.slot.id);
        changed.add(here.slot.id);
        if (currentBand && !canPlaceBandInSlot(currentBand, here.day, here.slot, venueHours)) {
          swapBlocked = true;
          warnings.push(
            `入れ替えると現トリの${currentBand.name}が${here.day.label} ${here.slot.startTime || "その枠"}に入れません`,
          );
        }
      } else {
        nextDays = days.map((d) =>
          d.id === day.id ? { ...d, slots: d.slots.map((s) => (s.id === slot.id ? { ...s, bandId: band.id } : s)) } : d,
        );
      }
      const affected = new Set<string>([day.id]);
      if (here) affected.add(here.day.id);
      for (const id of affected) {
        const original = days.find((d) => d.id === id);
        const next = nextDays.find((d) => d.id === id);
        if (!original || !next) continue;
        const ctx = buildScheduleContext(original, bands, venueHours);
        const baseline = baselineFor(original);
        const nextBandMap = new Map(bands.map((b) => [b.id, b]));
        for (const v of validateHardConstraints(next.slots, ctx).violations) {
          if (v.type === "TIME_CONSTRAINT") continue; // 時間指定は上で個別に判定済み
          if (baseline.has(violationKey(v))) continue;
          if (!v.slotIds.some((sid) => changed.has(sid))) continue;
          warnings.push(describeWarning(v, next.slots, nextBandMap));
        }
      }
    }

    results.push({ ...base, swapBlocked, status: warnings.length > 0 ? "warn" : "ok", blockers: [], warnings });
  }

  const order = { ok: 0, warn: 1, excluded: 2 } as const;
  results.sort(
    (a, b) =>
      order[a.status] - order[b.status] ||
      Number(b.isCurrentClosing) - Number(a.isCurrentClosing) ||
      b.rating - a.rating ||
      a.band.name.localeCompare(b.band.name, "ja"),
  );
  return results;
}
