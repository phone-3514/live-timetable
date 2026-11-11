import type { Band, TimetableDay } from "../types";
import type { VenueHours } from "./parseBands";
import { canPlaceBandInSlot } from "./scheduleEligibility";
import { explainBlockers } from "./closingCandidates";
import { TIME_RESTRICTION_BUFFER_MINUTES } from "./memberConstraints";

export type PlacementViolation = {
  /** "violation": 時間指定に反している(赤)。 "tight": 指定には収まっているが前後の
   * 余裕(TIME_RESTRICTION_BUFFER_MINUTES)が取れていない(黄)。 */
  severity: "violation" | "tight";
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
 * 矛盾していないかを見つけるためのもの。指定そのものに反していれば "violation"、指定には
 * 収まっているが前後 TIME_RESTRICTION_BUFFER_MINUTES 分の余裕がなければ "tight"。 */
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
      const strictOk = canPlaceBandInSlot(band, day, slot, venueHours);
      if (
        strictOk &&
        canPlaceBandInSlot(band, day, slot, venueHours, { bufferMinutes: TIME_RESTRICTION_BUFFER_MINUTES })
      ) {
        continue;
      }
      out.push({
        severity: strictOk ? "tight" : "violation",
        dayId: day.id,
        dayLabel: day.label,
        slotId: slot.id,
        bandId: band.id,
        bandName: band.name,
        startTime: slot.startTime,
        endTime: slot.endTime,
        reasons: strictOk
          ? explainBlockers(band, day, slot, venueHours, TIME_RESTRICTION_BUFFER_MINUTES)
          : explainBlockers(band, day, slot, venueHours),
      });
    }
  }
  return out;
}
