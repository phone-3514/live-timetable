import type { Band, TimetableDay } from "../types";
import { timeToMinutes } from "./time";

export type Changeover = {
  /** 転換後に出る枠(バンド B の枠)の id — この枠の直前に表示する。 */
  toSlotId: string;
  fromSlotId: string;
  /** 転換の前に出る側のバンド(空き枠なら null)。転換時間の個別設定はこのバンドに付く。 */
  fromBandId: string | null;
  /** 前の出番の終了〜次の出番の開始(実際の間隔・分)。 */
  gap: number;
  /** この間隔の規定の転換時間(分) — 前のバンドの個別設定、なければその日の既定。 */
  required: number;
  /** 間に「余白」(非表示ブロック)が挟まっているか — その場合は転換時間が入らない。 */
  viaMargin: boolean;
  /** 間に挟まっている余白ブロックの id と、その合計分数。 */
  marginSlotIds: string[];
  marginMinutes: number;
};

/** 各出演枠について「前の出番との間の転換」を求める。間に休憩・集合などの表示される
 * ブロックが挟まる所は意図した間隔なので対象外。間に余白(hidden)だけ挟まる所は、
 * 余白には転換時間が付かないため、間隔が規定より短くなりうる(viaMargin)。 */
export function computeChangeovers(day: TimetableDay, bands: Band[]): Map<string, Changeover> {
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  const out = new Map<string, Changeover>();
  let prev: (typeof day.slots)[number] | null = null;
  let margins: (typeof day.slots)[number][] = [];
  for (const slot of day.slots) {
    if (slot.customLabel !== null) {
      if (slot.hidden && prev) margins.push(slot);
      else {
        // 休憩・集合などの表示されるブロック: ここで連鎖を切る。
        prev = null;
        margins = [];
      }
      continue;
    }
    if (prev && prev.endTime && slot.startTime) {
      const fromBand = prev.bandId ? bandMap.get(prev.bandId) : undefined;
      const required = fromBand?.customTransitionMinutes ?? day.settings.transitionMinutes;
      let gap = timeToMinutes(slot.startTime) - timeToMinutes(prev.endTime);
      if (gap < 0) gap += 1440;
      out.set(slot.id, {
        toSlotId: slot.id,
        fromSlotId: prev.id,
        fromBandId: fromBand?.id ?? null,
        gap,
        required,
        viaMargin: margins.length > 0,
        marginSlotIds: margins.map((m) => m.id),
        marginMinutes: margins.reduce((sum, m) => sum + (m.customDurationMinutes ?? 0), 0),
      });
    }
    prev = slot;
    margins = [];
  }
  return out;
}
