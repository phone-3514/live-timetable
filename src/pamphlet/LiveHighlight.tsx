import type { CSSProperties } from "react";

// 「演奏中！」の枠を豪華に見せる部品。見た目の動き(光の帯・脈打つ発光・イコライザ・
// きらめき)は index.css の .pamphlet-live-* にまとめてあり、「モーション軽減」
// (data-reduce-motion / prefers-reduced-motion)では止まって、リング・グラデーション・
// バッジの静止した見た目だけが残る。転換中・休憩中などの強調は従来どおり静止のまま。

/** 「♪ 演奏中！」のバッジ(イコライザ付き)。色は style で上書きできる(デザイン指定時はテーマの番号バッジ色)。 */
export function LiveBadge({ label, style }: { label: string; style?: CSSProperties }) {
  return (
    <span className="pamphlet-live-badge" style={style}>
      <span className="pamphlet-eq" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {label}
    </span>
  );
}

/** 枠の中できらめく星(装飾)。親が .pamphlet-live-row(position:relative)であること。 */
export function LiveSparkles() {
  return (
    <>
      <span className="pamphlet-sparkle pamphlet-sparkle-a" aria-hidden="true">
        ✦
      </span>
      <span className="pamphlet-sparkle pamphlet-sparkle-b" aria-hidden="true">
        ✧
      </span>
      <span className="pamphlet-sparkle pamphlet-sparkle-c" aria-hidden="true">
        ✦
      </span>
    </>
  );
}
