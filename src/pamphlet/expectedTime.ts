import type { PublicSlot } from "./types";

// 公開パンフレットに出す「見込み」の開始–終了時刻。公開データの startTime/endTime は
// 当日運営での時刻補正(○分遅れ・早める)を反映した現時点の見込みなので、そのまま使う
// (元の予定は運営画面だけに出す)。
export function expectedTimeText(slot: PublicSlot): string | null {
  if (!slot.startTime || !slot.endTime) return null;
  return `${slot.startTime.slice(0, 5)}–${slot.endTime.slice(0, 5)}`;
}
