import { ThemeArtwork } from "./ThemeArtwork";
import { artworkScale } from "../utils/shareArtwork";
import type { Band, TimetableDay, TimetableSlot } from "../types";
import { LAYOUTS, THEMES } from "../utils/shareThemes";
import type { LayoutId, ShareTheme, ThemeId } from "../utils/shareThemes";
import type { EventInfo } from "../store/useAppStore";
import { isHiddenBlock } from "../utils/slotKinds";
import { timeToMinutes } from "../utils/time";

// 「ボード」レイアウト — 視認性最優先の縦長タイムテーブル。
// 一列に「開始時刻 / 出演順 / バンド名」だけを大きく並べ、日ごとに大きな日付見出しを
// 付ける(セットリストや SYNC/KEY は載せない)。2日分なら日の間に時刻の目盛りを置く。
// 他のレイアウト(カード型)とは構造そのものが違うため、ShareTimetableTemplate /
// ShareAllDaysTemplate から layout.structure === "board" のときだけ呼ばれる。
const PAD = 48;
const COL_W = 660;
const COL_GAP = 28;
const AXIS_W = 120;
const ROW_H = 68;
const ROW_GAP = 4;
const HEAD_H = 120;
const HEAD_GAP = 20;
const TIME_W = 156;
const NUM_W = 64;
const NAME_PAD = 16;
const NAME_MAX_FONT = 34;
const NAME_MIN_FONT = 20;
const NAME_AVAIL = COL_W - TIME_W - NUM_W - NAME_PAD;
const TARGET_ASPECT = 16 / 9;
const HEADER_H = 150;
const FOOTER_H = 70;
const OUTER_GAP = 32;

type Row = { slot: TimetableSlot; startMin: number };

function visibleRows(day: TimetableDay): Row[] {
  return day.slots
    .filter((s) => (s.bandId !== null || s.customLabel !== null) && !isHiddenBlock(s))
    .map((slot) => ({ slot, startMin: timeToMinutes(slot.startTime) }));
}

// 全角を1、半角を約0.58として横幅を見積もり、枠に収まるフォントサイズを返す。
function fitFontSize(text: string, avail: number): number {
  let units = 0;
  for (const ch of text) units += /[\x00-\x7f｡-ﾟ]/.test(ch) ? 0.58 : 1;
  if (units <= 0) return NAME_MAX_FONT;
  return Math.max(NAME_MIN_FONT, Math.min(NAME_MAX_FONT, Math.floor(avail / units)));
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function dayHeading(day: TimetableDay): { big: string; small: string | null } {
  if (day.date) {
    const d = new Date(`${day.date}T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      return {
        big: `${d.getMonth() + 1}.${pad2(d.getDate())}`,
        small: d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase(),
      };
    }
  }
  return { big: day.label, small: null };
}

// 目盛り: 各「正時」を、いちばん近い出演行の高さに置く(1行に複数は置かない)。
function hourMarks(rows: Row[]): { index: number; label: string }[] {
  if (rows.length === 0) return [];
  const first = rows[0].startMin;
  const last = rows[rows.length - 1].startMin;
  const used = new Set<number>();
  const marks: { index: number; label: string }[] = [];
  for (let h = Math.ceil(first / 60) * 60; h <= last + 30; h += 60) {
    let best = -1;
    let bestDiff = Infinity;
    rows.forEach((r, i) => {
      const diff = Math.abs(r.startMin - h);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    });
    if (best < 0 || bestDiff > 35 || used.has(best)) continue;
    used.add(best);
    marks.push({ index: best, label: `${pad2(Math.floor(h / 60) % 24)}:00` });
  }
  return marks;
}

// 16:9 に近づく「1列あたりの行数」を全日まとめて探す(日ごとの高さを揃える)。
function chooseRowTarget(rowCounts: number[]): number {
  const maxRows = Math.max(...rowCounts, 1);
  let best = maxRows;
  let bestDiff = Infinity;
  for (let r = 1; r <= maxRows; r++) {
    const height =
      PAD * 2 + HEADER_H + FOOTER_H + OUTER_GAP * 2 + HEAD_H + HEAD_GAP + r * ROW_H + Math.max(r - 1, 0) * ROW_GAP;
    let width = PAD * 2 + COL_GAP * Math.max(rowCounts.length - 1, 0);
    for (const rows of rowCounts) {
      const cols = Math.max(1, Math.ceil(rows / r));
      width += COL_W * cols + COL_GAP * (cols - 1);
    }
    const diff = Math.abs(Math.log(width / height) - Math.log(TARGET_ASPECT));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = r;
    }
  }
  return best;
}

function BoardRow({
  row,
  order,
  bandName,
  theme,
  radius,
}: {
  row: Row;
  order: number | null;
  bandName: string;
  theme: ShareTheme;
  radius: number;
}) {
  const { slot } = row;
  const isBand = order !== null;
  const text = isBand ? bandName : (slot.customLabel ?? "");
  return (
    <div
      className="flex items-stretch overflow-hidden"
      style={{
        height: ROW_H,
        borderRadius: radius,
        background: isBand ? theme.cardBg : theme.breakBg,
      }}
    >
      <div
        className="flex shrink-0 items-center justify-center font-mono font-bold"
        style={{
          width: TIME_W,
          fontSize: 32,
          background: theme.numberBadgeBackground,
          color: theme.numberBadgeText,
        }}
      >
        {slot.startTime.slice(0, 5)}~
      </div>
      <div
        className="flex shrink-0 items-center justify-center font-bold"
        style={{ width: NUM_W, fontSize: 30, color: theme.timeColor }}
      >
        {isBand ? order : ""}
      </div>
      <div className="flex min-w-0 flex-1 items-center" style={{ paddingRight: NAME_PAD }}>
        <span
          className="font-bold"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            lineHeight: 1.12,
            overflowWrap: "anywhere",
            fontSize: fitFontSize(text, NAME_AVAIL),
            color: isBand ? theme.bandNameColor : theme.breakText,
          }}
        >
          {text}
        </span>
      </div>
    </div>
  );
}

function HourAxis({ rows }: { rows: Row[] }) {
  const marks = hourMarks(rows);
  const height = rows.length * ROW_H + Math.max(rows.length - 1, 0) * ROW_GAP;
  return (
    <div className="flex shrink-0 flex-col" style={{ width: AXIS_W, gap: HEAD_GAP }}>
      <div style={{ height: HEAD_H }} />
      <div className="relative" style={{ height }}>
        {marks.map((m) => (
          <span
            key={m.index}
            className="absolute left-0 right-0 text-center font-bold"
            style={{
              top: m.index * (ROW_H + ROW_GAP) + ROW_H / 2,
              transform: "translateY(-50%)",
              fontSize: 30,
              color: "inherit",
            }}
          >
            {m.label}
          </span>
        ))}
      </div>
    </div>
  );
}

type Props = {
  days: TimetableDay[];
  bands: Band[];
  themeId: ThemeId;
  eventInfo: EventInfo;
  layoutId: LayoutId;
  widescreen?: boolean;
};

export function ShareBoardTemplate({ days, bands, themeId, eventInfo, layoutId, widescreen = false }: Props) {
  const theme = THEMES[themeId];
  const layout = LAYOUTS[layoutId];
  const bandName = new Map(bands.map((b) => [b.id, b.name]));

  const dayRows = days.map(visibleRows);
  const rowTarget = widescreen ? chooseRowTarget(dayRows.map((r) => r.length)) : null;
  const sections = days.map((day, i) => {
    const rows = dayRows[i];
    const columnCount = rowTarget ? Math.max(1, Math.ceil(rows.length / rowTarget)) : 1;
    const perColumn = Math.max(1, Math.ceil(rows.length / columnCount));
    const columns: Row[][] = [];
    for (let k = 0; k < rows.length; k += perColumn) columns.push(rows.slice(k, k + perColumn));
    // 出演順の番号は日をまたがず、列をまたいで通し番号。
    const orders = new Map<string, number>();
    let n = 0;
    for (const r of rows) if (r.slot.bandId) orders.set(r.slot.id, ++n);
    return { day, rows, columns, orders, width: COL_W * Math.max(columns.length, 1) + COL_GAP * Math.max(columns.length - 1, 0) };
  });

  // 目盛りは「2日まで・全日が1列・正時が2か所以上」のときだけ(1日目の行に合わせるので、
  // 3日以上や短い日では かえって紛らわしい)。2日なら日の間、1日なら左端。
  const showAxis =
    sections.length > 0 &&
    sections.length <= 2 &&
    sections.every((s) => s.columns.length <= 1) &&
    hourMarks(sections[0].rows).length >= 2;
  const axisBetween = showAxis && sections.length === 2;
  const axisCount = showAxis ? 1 : 0;
  const contentWidth =
    sections.reduce((sum, s) => sum + s.width, 0) +
    COL_GAP * Math.max(sections.length - 1, 0) +
    axisCount * (AXIS_W + COL_GAP) -
    (axisBetween ? COL_GAP : 0);
  const canvasWidth = PAD * 2 + Math.max(contentWidth, 900);

  const title = eventInfo.liveName || days.map((d) => d.label).join(" ・ ");
  const artScale = theme.artwork ? artworkScale(canvasWidth) : 1;

  const renderSection = (s: (typeof sections)[number]) => {
    const heading = dayHeading(s.day);
    return (
      <div key={s.day.id} className="flex shrink-0 flex-col" style={{ width: s.width, gap: HEAD_GAP }}>
        <div
          className="flex items-baseline justify-center font-black"
          style={{
            height: HEAD_H,
            gap: 18,
            borderRadius: layout.cardRadius,
            background: theme.numberBadgeBackground,
            color: theme.numberBadgeText,
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: heading.small ? 84 : 60, lineHeight: 1 }}>{heading.big}</span>
          {heading.small && <span style={{ fontSize: 38, lineHeight: 1 }}>{heading.small}</span>}
        </div>
        {s.columns.length === 0 ? (
          <p className="text-center" style={{ fontSize: 24, color: theme.footerColor }}>
            まだ配置されたバンドがありません
          </p>
        ) : (
          <div className="flex" style={{ gap: COL_GAP }}>
            {s.columns.map((col, ci) => (
              <div key={ci} className="flex shrink-0 flex-col" style={{ width: COL_W, gap: ROW_GAP }}>
                {col.map((row) => (
                  <BoardRow
                    key={row.slot.id}
                    row={row}
                    order={s.orders.get(row.slot.id) ?? null}
                    bandName={row.slot.bandId ? (bandName.get(row.slot.bandId) ?? "") : ""}
                    theme={theme}
                    radius={layout.cardRadius}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        width: canvasWidth,
        background: theme.pageBackground,
        padding: PAD,
        paddingTop: PAD + (theme.artworkTopInset?.(artScale) ?? 0),
        paddingBottom: PAD + (theme.artworkBottomInset ?? 0) * artScale,
      }}
      className="relative overflow-hidden"
    >
      <ThemeArtwork layers={theme.artwork} scale={artScale} />
      {theme.glowSpots.map((spot, i) => (
        <div
          key={i}
          className="pointer-events-none absolute rounded-full blur-3xl"
          style={{
            background: spot.background,
            top: spot.top,
            bottom: spot.bottom,
            left: spot.left,
            right: spot.right,
            width: spot.size,
            height: spot.size,
          }}
        />
      ))}
      {theme.watermarkPattern && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: theme.watermarkPattern, backgroundRepeat: "repeat" }}
        />
      )}

      <div className="relative flex flex-col" style={{ gap: OUTER_GAP }}>
        <header className="flex flex-wrap items-baseline justify-center" style={{ columnGap: 24, rowGap: 6 }}>
          <h1 className="font-black leading-tight" style={{ fontSize: 84, color: theme.dayTitleColor }}>
            {title}
          </h1>
          {eventInfo.venue && (
            <span className="font-bold" style={{ fontSize: 30, color: theme.dateColor, whiteSpace: "nowrap" }}>
              @{eventInfo.venue}
            </span>
          )}
        </header>

        <div className="flex items-start justify-center" style={{ gap: COL_GAP, color: theme.dateColor }}>
          {showAxis && !axisBetween && <HourAxis rows={sections[0].rows} />}
          {sections.map((s, i) => (
            <div key={s.day.id} className="flex items-start" style={{ gap: COL_GAP, color: theme.dateColor }}>
              {renderSection(s)}
              {axisBetween && i === 0 && <HourAxis rows={sections[0].rows} />}
            </div>
          ))}
        </div>

        <footer className="text-center">
          {eventInfo.organizationName && (
            <p className="font-semibold tracking-wide" style={{ fontSize: 24, color: theme.dateColor }}>
              {eventInfo.organizationName}
            </p>
          )}
          <p style={{ fontSize: 14, marginTop: eventInfo.organizationName ? 4 : 0, color: theme.footerColor }}>
            軽音ライブ タイムテーブル作成
          </p>
        </footer>
      </div>
    </div>
  );
}
