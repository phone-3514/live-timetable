import type { Band, TimetableDay } from "../types";
import { normalizeMemberName } from "./normalizeMemberName";

export type BandPlacement = {
  dayId: string;
  dayLabel: string;
  startTime: string;
  endTime: string;
};

export type SharedMemberPair = {
  a: Band;
  b: Band;
  /** 共通メンバー(表示名)。a 側の表記を使う。 */
  sharedNames: string[];
  placementA: BandPlacement | null;
  placementB: BandPlacement | null;
  /** 同じ日の連続した出演枠(間に別バンドが入らない)になっているか。 */
  adjacent: boolean;
};

// 名前の表記ゆれ(全角/半角スペース等)は normalizeMemberName で同一視する。
function memberKeys(band: Band): Map<string, string> {
  const keys = new Map<string, string>();
  for (const raw of band.members) {
    const key = normalizeMemberName(raw);
    if (key && !keys.has(key)) keys.set(key, raw);
  }
  return keys;
}

/** メンバーが minShared 人以上重なっているバンドの組を、重なりの多い順に返す。 */
export function findSharedMemberPairs(
  bands: Band[],
  days: TimetableDay[],
  minShared = 2,
): SharedMemberPair[] {
  const placementByBand = new Map<string, BandPlacement>();
  // 出演枠(バンドが入る枠)だけを並べた日ごとの順序 — 隣り合うかの判定用。
  const orderByDay = new Map<string, string[]>();
  for (const day of days) {
    const order: string[] = [];
    for (const slot of day.slots) {
      if (slot.customLabel !== null) continue;
      if (!slot.bandId) continue;
      order.push(slot.bandId);
      if (!placementByBand.has(slot.bandId)) {
        placementByBand.set(slot.bandId, {
          dayId: day.id,
          dayLabel: day.label,
          startTime: slot.startTime,
          endTime: slot.endTime,
        });
      }
    }
    orderByDay.set(day.id, order);
  }

  // メンバー → 所属バンドの逆引きで、共有のあり得る組だけを数える。
  const keysByBand = new Map<string, Map<string, string>>();
  const bandsByMember = new Map<string, string[]>();
  for (const band of bands) {
    const keys = memberKeys(band);
    keysByBand.set(band.id, keys);
    for (const key of keys.keys()) {
      const list = bandsByMember.get(key) ?? [];
      list.push(band.id);
      bandsByMember.set(key, list);
    }
  }

  const bandById = new Map(bands.map((b) => [b.id, b]));
  const pairCounts = new Map<string, { aId: string; bId: string; keys: string[] }>();
  for (const [key, ids] of bandsByMember) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const pairKey = `${ids[i]}|${ids[j]}`;
        const entry = pairCounts.get(pairKey) ?? { aId: ids[i], bId: ids[j], keys: [] };
        entry.keys.push(key);
        pairCounts.set(pairKey, entry);
      }
    }
  }

  const pairs: SharedMemberPair[] = [];
  for (const { aId, bId, keys } of pairCounts.values()) {
    if (keys.length < minShared) continue;
    const a = bandById.get(aId);
    const b = bandById.get(bId);
    if (!a || !b) continue;
    const aKeys = keysByBand.get(aId);
    const placementA = placementByBand.get(aId) ?? null;
    const placementB = placementByBand.get(bId) ?? null;
    let adjacent = false;
    if (placementA && placementB && placementA.dayId === placementB.dayId) {
      const order = orderByDay.get(placementA.dayId) ?? [];
      const ia = order.indexOf(aId);
      const ib = order.indexOf(bId);
      adjacent = ia >= 0 && ib >= 0 && Math.abs(ia - ib) === 1;
    }
    pairs.push({
      a,
      b,
      sharedNames: keys.map((k) => aKeys?.get(k) ?? k),
      placementA,
      placementB,
      adjacent,
    });
  }

  return pairs.sort(
    (x, y) =>
      y.sharedNames.length - x.sharedNames.length ||
      x.a.name.localeCompare(y.a.name, "ja") ||
      x.b.name.localeCompare(y.b.name, "ja"),
  );
}
