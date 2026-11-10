import type { Band, TimetableDay } from "../types";
import type { VenueHours } from "./parseBands";
import { canPlaceBandInSlot } from "./scheduleEligibility";
import { explainBlockers } from "./closingCandidates";

export type PlacementViolation = {
  dayId: string;
  dayLabel: string;
  slotId: string;
  bandId: string;
  bandName: string;
  startTime: string;
  endTime: string;
  reasons: string[];
};

/** いま配置されているバンドのうち、日時指定(出演可能日・NG/希望時間・メンバー/理由メモの
 * 時間指定)に反している枠の一覧。時間指定を後から変えたときに、すでに置いた配置が
 * 矛盾していないかを見つけるためのもの。余裕時間は取らず、書かれたとおりに判定する。 */
export function findPlacementViolations(
  days: TimetableDay[],
  bands: Band[],
  venueHours: VenueHours,
): PlacementViolation[] {
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const out: PlacementViolation[] = [];
  for (const day of days) {
    for (const slot of day.slots) {
      if (!slot.bandId || slot.customLabel !== null) continue;
      const band = bandMap.get(slot.bandId);
      if (!band) continue;
      if (canPlaceBandInSlot(band, day, slot, venueHours)) continue;
      out.push({
        dayId: day.id,
        dayLabel: day.label,
        slotId: slot.id,
        bandId: band.id,
        bandName: band.name,
        startTime: slot.startTime,
        endTime: slot.endTime,
        reasons: explainBlockers(band, day, slot, venueHours),
      });
    }
  }
  return out;
}
