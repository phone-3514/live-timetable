// 「演奏中！」のあいだだけ、タイムテーブルの左右に音符や楽器がふわふわ漂う演出。
// 装飾なので aria-hidden・クリックは受け取らない。動きは index.css の .perf-item で、
// 既存の「モーション軽減」設定(data-reduce-motion)とOSの設定(prefers-reduced-motion)では
// 止まって(見えなく)なる。転換中・休憩中などバンドが演奏していない間は出さない。
type Item = { glyph: string; x: number; dur: number; delay: number; sway: number; size: number; instrument?: boolean };

// x は各サイド領域の中での横位置(%)。個数は左右3つずつに絞り、1つ1つを大きく見せる。
// 周期を長め(15秒)にして delay を等間隔(負の値=表示した瞬間から途中まで進んだ状態)に
// ずらすので、いつも各サイドに1〜2個が漂っている。
const LEFT: Item[] = [
  { glyph: "🎸", x: 30, dur: 15, delay: 0, sway: 14, size: 1, instrument: true },
  { glyph: "♫", x: 15, dur: 15, delay: -5, sway: 12, size: 1 },
  { glyph: "♪", x: 35, dur: 15, delay: -10, sway: 14, size: 1 },
];
const RIGHT: Item[] = [
  { glyph: "♬", x: 20, dur: 15, delay: -2.5, sway: 12, size: 1 },
  { glyph: "🎹", x: 25, dur: 15, delay: -7.5, sway: 14, size: 1, instrument: true },
  { glyph: "🥁", x: 15, dur: 15, delay: -12.5, sway: 12, size: 1, instrument: true },
];

function Side({ side, items }: { side: "left" | "right"; items: Item[] }) {
  return (
    <div className={`perf-motion-side perf-motion-${side}`}>
      {items.map((it, i) => (
        <span
          key={i}
          className={`perf-item${it.instrument ? " perf-item-instrument" : ""}`}
          style={
            {
              left: `${it.x}%`,
              fontSize: `${it.size}em`,
              "--dur": `${it.dur}s`,
              "--delay": `${it.delay}s`,
              "--sway": `${it.sway}px`,
            } as React.CSSProperties
          }
        >
          {it.glyph}
        </span>
      ))}
    </div>
  );
}

export function PerformingMotion({ color }: { color?: string }) {
  return (
    <div
      className="perf-motion"
      aria-hidden="true"
      style={color ? ({ "--perf-color": color } as React.CSSProperties) : undefined}
    >
      <Side side="left" items={LEFT} />
      <Side side="right" items={RIGHT} />
    </div>
  );
}
