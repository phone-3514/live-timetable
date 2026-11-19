// 共有画像の背景に敷く、大きなイラスト(マイク・銀杏の葉・五線譜など)。
// どれもコードで描いたSVGで、画像ファイルは使わない。キャンバスの高さはバンド数で変わるため、
// 位置は上下左右の端からのpx指定にしてある。内容(カード・文字)より後ろに描かれる。

export type ArtworkLayer = {
  /** data URI にしたSVG(artworkLayer() で作る)。 */
  uri: string;
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  width?: number;
  height: number;
  opacity?: number;
  /** 度。時計回りが正。 */
  rotate?: number;
  /** true のとき、左右いっぱいに横方向へ繰り返して敷く(波・五線譜などの帯用)。 */
  repeatX?: boolean;
};

const toUri = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

const NAVY = "#12356b";
const ORANGE = "#f4734f";

// ---- マイク(ダイナミックマイク+音のしぶき+ケーブル)。欠けないよう全体をviewBoxに収める ----
const MIC_VIEWBOX = { w: 400, h: 660 };
const MIC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-30 -10 ${MIC_VIEWBOX.w} ${MIC_VIEWBOX.h}">
<g fill="${NAVY}">
<circle cx="200" cy="125" r="102"/>
<rect x="116" y="204" width="168" height="34" rx="14"/>
<path d="M126 232 L274 232 L246 478 Q243 504 217 504 L183 504 Q157 504 154 478 Z"/>
</g>
<g fill="none" stroke="#ffffff" stroke-opacity="0.4" stroke-width="5" stroke-linecap="round">
<path d="M112 84 Q200 114 288 84"/><path d="M99 128 H301"/><path d="M112 172 Q200 142 288 172"/>
<path d="M200 28 V224"/><path d="M148 38 Q128 126 148 214"/><path d="M252 38 Q272 126 252 214"/>
</g>
<path d="M200 504 C232 566 118 570 170 636" fill="none" stroke="${NAVY}" stroke-width="13" stroke-linecap="round"/>
<g stroke="${ORANGE}" stroke-width="15" stroke-linecap="round">
<path d="M70 58 L28 26"/><path d="M48 112 L0 106"/><path d="M72 166 L30 196"/>
</g>
</svg>`;
const MIC_ASPECT = MIC_VIEWBOX.w / MIC_VIEWBOX.h;

// ---- 銀杏の葉(扇形・中央の切れ込み・縁のぎざぎざ・放射状の葉脈) ----
const GINKGO_VIEWBOX = { x: -112, y: -116, w: 224, h: 150 };
export const GINKGO_ASPECT = GINKGO_VIEWBOX.w / GINKGO_VIEWBOX.h;
function ginkgoSvg(fill: string, vein: string): string {
  const polar = (angleDeg: number, r: number) => {
    const a = (angleDeg * Math.PI) / 180;
    return `${(r * Math.sin(a)).toFixed(1)} ${(-r * Math.cos(a)).toFixed(1)}`;
  };
  const edge: string[] = [];
  for (let a = -84; a <= 84; a += 6) {
    const d = Math.abs(a);
    let r = 104 - (Math.round(d / 6) % 2 === 0 ? 0 : 5); // 縁を少し波打たせる
    if (d < 12) r -= (12 - d) * 4.2; // 中央の切れ込み
    edge.push(polar(a, r));
  }
  const veins = [-62, -34, -14, 14, 34, 62].map((a) => `<path d="M0 4 L${polar(a, 88)}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${GINKGO_VIEWBOX.x} ${GINKGO_VIEWBOX.y} ${GINKGO_VIEWBOX.w} ${GINKGO_VIEWBOX.h}">
<path d="M0 32 L0 6" stroke="${vein}" stroke-width="6" stroke-linecap="round"/>
<path d="M0 4 L${edge.join(" L")} Z" fill="${fill}" stroke="${fill}" stroke-width="6" stroke-linejoin="round"/>
<g stroke="${vein}" stroke-opacity="0.5" stroke-width="2.4" fill="none" stroke-linecap="round">${veins}</g>
</svg>`;
}
const leaf = (height: number) => ({ height, width: Math.round(height * GINKGO_ASPECT) });

// ---- 波打つ紺の帯+五線譜+音符(横に繰り返しても継ぎ目が出ない) ----
const STAFF_Y = [150, 166, 182, 198, 214];
const WAVE_TILE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 300" preserveAspectRatio="none">
<path d="M0 112 C200 42 400 42 600 112 S1000 182 1200 112 V300 H0 Z" fill="${NAVY}"/>
<g fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="2.4">
${STAFF_Y.map((y) => `<path d="M0 ${y} C200 ${y - 70} 400 ${y - 70} 600 ${y} S1000 ${y + 70} 1200 ${y}"/>`).join("\n")}
</g>
<g fill="#ffffff">
<g transform="translate(250 138)"><ellipse cx="0" cy="40" rx="15" ry="11" transform="rotate(-22 0 40)"/><rect x="11" y="-34" width="4" height="74"/><path d="M15 -34 C32 -22 34 -4 28 8 C28 -8 22 -14 15 -18 Z"/></g>
<g transform="translate(560 118)"><ellipse cx="0" cy="58" rx="15" ry="11" transform="rotate(-22 0 58)"/><ellipse cx="52" cy="50" rx="15" ry="11" transform="rotate(-22 52 50)"/><rect x="11" y="-14" width="4" height="72"/><rect x="63" y="-22" width="4" height="72"/><path d="M11 -14 L67 -24 L67 -8 L11 2 Z"/></g>
<g transform="translate(930 150)"><ellipse cx="0" cy="40" rx="15" ry="11" transform="rotate(-22 0 40)"/><rect x="11" y="-34" width="4" height="74"/><path d="M15 -34 C32 -22 34 -4 28 8 C28 -8 22 -14 15 -18 Z"/></g>
</g>
</svg>`;

/** 「Stage / Mic」テーマの背景イラスト一式。サイズ・位置はすべて基準幅(ARTWORK_BASE_WIDTH)のときのpx。
 * 絵は端で切れないようすべてキャンバスの内側に収め、不透明で描いて全体がはっきり見えるようにする。 */
const MIC_H = 400;
export const STAGE_ARTWORK: ArtworkLayer[] = [
  // 上: タイトルの右脇に、マイクを欠けずに大きく。
  { uri: toUri(MIC_SVG), top: 6, right: 80, width: Math.round(MIC_H * MIC_ASPECT), height: MIC_H, rotate: 14 },
  // 下の波打つ五線譜の帯(左右いっぱいに繰り返す)。下の余白(artworkBottomInset)の中に収める。
  { uri: toUri(WAVE_TILE_SVG), bottom: 0, left: 0, right: 0, height: 250, repeatX: true },
  // 帯の上に載る銀杏の葉(欠けないよう左右の端から離す)
  { uri: toUri(ginkgoSvg("#b9cc3c", "#7f9420")), bottom: 150, left: 40, ...leaf(150), rotate: 14 },
  { uri: toUri(ginkgoSvg("#a9c02f", "#6e8219")), bottom: 146, right: 40, ...leaf(160), rotate: -16 },
];
/** 下の帯の分として、キャンバスの下に確保する余白(px・基準幅のとき)。文字・カードが帯に重ならないように。 */
export const STAGE_BOTTOM_INSET = 230;
/** 上のマイクの分として、キャンバスの上に足す余白(px)。絵の下端(傾きの分を含む)が
 * 最初のカードの行に隠れないよう、絵の拡大率 `scale` に合わせて決める。ヘッダー(タイトル等)の
 * 高さは拡大しないので、絵が大きいほど余白を多く取る。 */
export const stageTopInset = (scale: number): number => Math.max(0, 470 * scale - 350);

/** 上の寸法を決めた基準の幅(px)。実際のキャンバスがこれより広いとき(全日程まとめなど)は、
 * イラストも同じ割合で大きくして、絵がキャンバスに対して小さく見えないようにする。 */
export const ARTWORK_BASE_WIDTH = 1500;
export function artworkScale(canvasWidth: number): number {
  return Math.max(1, Math.pow(canvasWidth / ARTWORK_BASE_WIDTH, 0.65));
}
