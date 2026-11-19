// 時刻は "HH:MM"、秒があるときだけ "HH:MM:SS"。演奏時間や転換時間に小数の分(4.5分 など)を
// 使えるよう、内部の「分」は小数のまま持ち、文字列にするときだけ秒単位に丸める。
export function timeToMinutes(time: string): number {
  const [h, m, s] = time.split(":").map(Number);
  return h * 60 + m + (Number.isFinite(s) ? s / 60 : 0);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function minutesToTime(total: number): string {
  // 秒に丸めてから時分秒へ分ける(0.1分のような小数の誤差で 59.999 秒にならないように)。
  const seconds = Math.round(total * 60);
  const wrapped = ((seconds % 86400) + 86400) % 86400;
  const h = Math.floor(wrapped / 3600);
  const m = Math.floor((wrapped % 3600) / 60);
  const s = wrapped % 60;
  return s === 0 ? `${pad2(h)}:${pad2(m)}` : `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}
