import type { Band, TimetableDay } from "../types";
import { normalizeMemberName } from "./normalizeMemberName";

// 「現在N枠」表示(PlacedBandDetailModal)専用 — 全日程を通じて、指定した
// 人物(normalizeMemberName済みのキー)が含まれる"配置済み"の出演枠数を数える。
// 未配置のバンド・空き枠は対象外。同一枠内で名前が重複していても
// (`band.members.some`のため)1枠につき1回だけ数える。derivedな値であり、
// どこにも保存しない — 呼び出し側(コンポーネント)が都度計算する。開いている
// バンドだけでなく、他のバンド経由の出演も数える(全バンドを見るため)。
export function countAssignedSlotsForMember(
  days: TimetableDay[],
  bands: Band[],
  memberKey: string,
): number {
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  let count = 0;
  for (const day of days) {
    for (const slot of day.slots) {
      if (!slot.bandId) continue;
      const band = bandMap.get(slot.bandId);
      if (!band) continue;
      if (band.members.some((name) => normalizeMemberName(name) === memberKey)) count++;
    }
  }
  return count;
}
