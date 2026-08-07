import type { Band, TimetableDay, TimetableSlot } from "../types";
import type { VenueHours } from "./parseBands";
import { canPlaceBandInSlot } from "./scheduleEligibility";
import { normalizeMemberName } from "./normalizeMemberName";
import {
  buildScheduleContext,
  validateHardConstraints,
  type HardConstraintViolation,
  type ScheduleContext,
} from "./autoScheduleSolver";

// 手動「入替」アクション — 2つの出演枠の bandId だけを交換する。日をまたぐ
// 交換にも対応する。この機能全体を通じて守る不変条件:
//   - スロットのID・順序・日の順序・startTime/endTime/startTimeOverride/
//     delayMinutes・休憩やブロック境界・総スロット数は一切変更しない
//     (recomputeTimesを一度も呼ばない — 呼ぶと交換した2バンドの演奏時間差
//     で以降の時刻がずれてしまうため)。
//   - Bandオブジェクト自体(durationMinutes/customTransitionMinutes等)は
//     一切書き換えない。
//   - 出演可能時間・出演可能日の制約は既存のcanPlaceBandInSlot(ブロッキング)
//     を再利用し、ここでルールを複製しない。
//   - 連続出演・ブロック集中(評価5終盤集中例外を含む)は既存の
//     validateHardConstraints(autoScheduleSolver.ts)をそのまま再利用する
//     — この手動アクションでは両方とも警告(非ブロッキング)として扱う。

export type SwapValidationResult = {
  blockingReasons: string[];
  warnings: string[];
  canSwap: boolean;
};

export type SwapCandidate = {
  slotId: string;
  bandId: string;
  bandName: string;
  dayId: string;
  dayLabel: string;
  dayDate: string | null;
  startTime: string;
  endTime: string;
  restrictionLabel: string | null;
  validation: SwapValidationResult;
};

type SlotLocation = { day: TimetableDay; slot: TimetableSlot };

function findSlot(days: TimetableDay[], slotId: string): SlotLocation | null {
  for (const day of days) {
    const slot = day.slots.find((s) => s.id === slotId);
    if (slot) return { day, slot };
  }
  return null;
}

// バンドの割り当て(bandId)だけを入れ替える純粋関数 — 呼び出し側の検証
// (validateBandSwap)・store側の適用(useAppStore.ts の swapSlotBands)の
// 両方がこの1関数だけを経由することで、「時刻を一切変えない」という
// 仕様をコード上の1箇所だけに保つ。両方のスロットが見つからない場合は
// 何も変えずdaysをそのまま返す。
export function buildSwappedDays(
  days: TimetableDay[],
  firstSlotId: string,
  secondSlotId: string,
): TimetableDay[] {
  const first = findSlot(days, firstSlotId);
  const second = findSlot(days, secondSlotId);
  if (!first || !second) return days;
  const firstBandId = first.slot.bandId;
  const secondBandId = second.slot.bandId;
  return days.map((day) => ({
    ...day,
    slots: day.slots.map((s) => {
      if (s.id === firstSlotId) return { ...s, bandId: secondBandId };
      if (s.id === secondSlotId) return { ...s, bandId: firstBandId };
      return s;
    }),
  }));
}

// 希望・NG時間帯がある場合の短いラベル — 既存UIは常に生テキストをそのまま
// 表示するだけで(PlacedBandDetailModal等)、要約フォーマッタは存在しな
// かったため新規に用意する。既存の表示規約(生テキストをそのまま見せる)を
//踏襲し、値の解釈・パースはextractTimeRange等の既存ロジックに委ねない
// (このラベルはあくまで一覧表示用の短い注記であり、ブロッキング判定には
// 使わない — 判定は必ずcanPlaceBandInSlot経由)。
export function formatSwapRestrictionLabel(band: Band): string | null {
  const parts: string[] = [];
  if (band.desiredTime.trim()) parts.push(`希望: ${band.desiredTime.trim()}`);
  if (band.ngTime.trim()) parts.push(`NG: ${band.ngTime.trim()}`);
  return parts.length > 0 ? parts.join(" / ") : null;
}

const WARNING_VIOLATION_TYPES = new Set<HardConstraintViolation["type"]>([
  "CONSECUTIVE_APPEARANCE",
  "BLOCK_CONCENTRATION",
]);

// personId(normalizeMemberName後の正規化キー)から、実際に表示すべき生の
// メンバー名を復元する — normalizeMemberNameは比較専用のキーであり、
// 保存・表示に使ってはいけない(normalizeMemberName.tsの既存の注意書き
// どおり)。
function resolveDisplayName(personId: string, candidateBands: Band[]): string {
  for (const b of candidateBands) {
    for (const raw of b.members) {
      if (normalizeMemberName(raw) === personId) return raw;
    }
  }
  return personId;
}

// CONSECUTIVE_APPEARANCE違反を、実際の時刻・バンド名を含む具体的な文言へ
// 整形する — 既存のHardConstraintViolation.messageはバンド名2つだけの
// 簡潔な文なので(autoScheduleSolver.tsのvalidateHardConstraints参照)、
// この手動入替UI向けに人物名・時刻を補って仕様の例文形式に近づける。
// 判定ロジック自体(「連続出演かどうか」)は一切再実装せず、
// validateHardConstraintsが返した結果を整形するだけ。
function describeWarning(
  violation: HardConstraintViolation,
  slots: TimetableSlot[],
  bandMap: Map<string, Band>,
): string {
  if (violation.type === "CONSECUTIVE_APPEARANCE") {
    const slotById = new Map(slots.map((s) => [s.id, s]));
    const [slotIdA, slotIdB] = violation.slotIds;
    const slotA = slotById.get(slotIdA);
    const slotB = slotById.get(slotIdB);
    const bandA = slotA?.bandId ? bandMap.get(slotA.bandId) : undefined;
    const bandB = slotB?.bandId ? bandMap.get(slotB.bandId) : undefined;
    const personId = violation.personIds?.[0];
    const displayName = personId
      ? resolveDisplayName(personId, [bandA, bandB].filter((b): b is Band => !!b))
      : "出演者";
    return `${displayName}が連続出演になります: ${slotA?.startTime || "?"} ${bandA?.name ?? "?"} → ${slotB?.startTime || "?"} ${bandB?.name ?? "?"}`;
  }
  // BLOCK_CONCENTRATION — 既存メッセージが人物名・件数・上限をすでに含む
  // ため、そのまま再利用する(仕様の例文と同等の情報量)。
  return violation.message;
}

// 交換候補の完全な仮説状態(buildSwappedDays)をまず作り、それに対して
// 検証する — 一時的に片方だけ空にする、片方ずつassignするといった中間
// 状態は一切作らない(仕様どおり)。
export function validateBandSwap(
  days: TimetableDay[],
  bands: Band[],
  venueHours: VenueHours,
  firstSlotId: string,
  secondSlotId: string,
): SwapValidationResult {
  const first = findSlot(days, firstSlotId);
  const second = findSlot(days, secondSlotId);
  if (!first || !second || !first.slot.bandId || !second.slot.bandId) {
    return { blockingReasons: ["対象の出演枠が見つかりません"], warnings: [], canSwap: false };
  }
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const firstBand = bandMap.get(first.slot.bandId);
  const secondBand = bandMap.get(second.slot.bandId);
  if (!firstBand || !secondBand) {
    return { blockingReasons: ["対象のバンドが見つかりません"], warnings: [], canSwap: false };
  }

  // 出演可能時間・出演可能日 — 既存のcanPlaceBandInSlotをそのまま再利用。
  // 交換後の"目的地"(相手のスロット)に対して、それぞれのバンドをチェック
  // する。
  const blockingReasons: string[] = [];
  if (!canPlaceBandInSlot(secondBand, first.day, first.slot, venueHours)) {
    blockingReasons.push(
      `入替できません: ${secondBand.name}は${first.day.label}の${first.slot.startTime || "この枠"}に出演できません`,
    );
  }
  if (!canPlaceBandInSlot(firstBand, second.day, second.slot, venueHours)) {
    blockingReasons.push(
      `入替できません: ${firstBand.name}は${second.day.label}の${second.slot.startTime || "この枠"}に出演できません`,
    );
  }
  if (blockingReasons.length > 0) {
    return { blockingReasons, warnings: [], canSwap: false };
  }

  // 連続出演・ブロック集中(評価5終盤集中例外を含む) — この手動入替では
  // 警告扱い。既存のvalidateHardConstraintsをそのまま再利用し、判定ロジ
  // ックをここで複製しない。ブロック集中・連続出演はどちらも1日単位の
  // 概念のため、影響するそれぞれの日ごとに(元のdayから作った、スロット
  // 時刻に一切依存しないcontextで)個別に検証する。
  const swappedDays = buildSwappedDays(days, firstSlotId, secondSlotId);
  const affectedDayIds = new Set([first.day.id, second.day.id]);
  const warnings: string[] = [];
  for (const dayId of affectedDayIds) {
    const originalDay = days.find((d) => d.id === dayId);
    const swappedDay = swappedDays.find((d) => d.id === dayId);
    if (!originalDay || !swappedDay) continue;
    // finalPhaseStart・blocksはスロットの時刻・customLabel配置だけに依存し、
    // 入替はbandIdしか変えない(時刻は一切変更しない)ため、元のdayから
    // contextを作っても交換後のdayから作っても同じ値になる。
    const context: ScheduleContext = buildScheduleContext(originalDay, bands, venueHours);
    const result = validateHardConstraints(swappedDay.slots, context);
    for (const v of result.violations) {
      if (!WARNING_VIOLATION_TYPES.has(v.type)) continue;
      warnings.push(describeWarning(v, swappedDay.slots, bandMap));
    }
  }

  return { blockingReasons: [], warnings, canSwap: true };
}

// 「他の配置済みバンド」一覧 — 検索文字列でリアルタイムに絞り込み、選択中
// のスロット・同一bandId・未配置枠・非バンド枠(休憩等)を除外する。
export function listSwapCandidates(
  days: TimetableDay[],
  bands: Band[],
  venueHours: VenueHours,
  selectedSlotId: string,
  searchQuery = "",
): SwapCandidate[] {
  const selected = findSlot(days, selectedSlotId);
  if (!selected || !selected.slot.bandId) return [];
  const selectedBandId = selected.slot.bandId;
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const query = searchQuery.trim().toLowerCase();

  const results: SwapCandidate[] = [];
  for (const day of days) {
    for (const slot of day.slots) {
      if (slot.id === selectedSlotId) continue;
      if (slot.customLabel !== null) continue; // 非バンド枠は除外
      if (!slot.bandId) continue; // 未配置枠は除外
      if (slot.bandId === selectedBandId) continue; // 同一bandIdは除外
      const band = bandMap.get(slot.bandId);
      if (!band) continue;
      if (query && !band.name.toLowerCase().includes(query)) continue;
      results.push({
        slotId: slot.id,
        bandId: band.id,
        bandName: band.name,
        dayId: day.id,
        dayLabel: day.label,
        dayDate: day.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        restrictionLabel: formatSwapRestrictionLabel(band),
        validation: validateBandSwap(days, bands, venueHours, selectedSlotId, slot.id),
      });
    }
  }
  return results;
}
