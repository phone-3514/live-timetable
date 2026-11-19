// 時刻は "HH:MM"。演奏時間や転換時間に小数の分(4.5分 など)を使えるよう、内部の「分」は小数の
// まま持つ(累積した時刻がずれないように)が、時刻の文字列にするときは秒を切り捨てる。
// 読み込みでは "HH:MM:SS" も受け付ける(古いデータ用)。
export function timeToMinutes(time: string): number {
  const [h, m, s] = time.split(":").map(Number);
  return h * 60 + m + (Number.isFinite(s) ? s / 60 : 0);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function minutesToTime(total: number): string {
  // いったん秒に丸めてから分未満を切り捨てる(0.1分のような小数の誤差で 1 分ずれないように)。
  const wholeMinutes = Math.floor(Math.round(total * 60) / 60);
  const wrapped = ((wholeMinutes % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(wrapped / 60))}:${pad2(wrapped % 60)}`;
}
