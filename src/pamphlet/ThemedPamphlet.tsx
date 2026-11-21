import type { CSSProperties } from "react";
import { ThemeArtwork } from "../components/ThemeArtwork";
import { getSetlistPalette } from "../utils/shareThemes";
import type { LayoutStyle, ShareTheme } from "../utils/shareThemes";
import { buildPamphletRows } from "./transitionGaps";
import type { PublicBand, PublicDay, PublicPamphletDoc, PublicSlot } from "./types";

// 公開パンフレットを、運営が公開時に選んだデザイン(共有用画像と同じ色テーマ +
// レイアウト構造)で描画するための部品。選ばれていないときの従来のシンプル表示は
// PublicPamphletRoot 側にそのまま残っていて、ここは使われない。
// 色は ShareTheme のトークンをインラインstyleで当てる(テーマは実行時に選ばれる
// データなので Tailwind の固定クラスでは書けない)。進行中の枠の強調は、
// numberBadgeBackground がグラデーションのことがあるため、必ず単色の timeColor を使う。

const ARTWORK_SCALE_PAGE = 0.5;
const ARTWORK_SCALE_PREVIEW = 0.32;

export function themeTextColor(theme: ShareTheme): string {
  return theme.bandNameColor;
}

// ページ全体(position:fixed)またはプレビュー枠(position:absolute)の背景。
// 内容の後ろに置く。クリックは受け取らない。
export function ThemedBackdrop({ theme, mode }: { theme: ShareTheme; mode: "page" | "preview" }) {
  const solid = getSetlistPalette(theme).pageFillSolid;
  return (
    <div
      className={`pointer-events-none overflow-hidden ${mode === "page" ? "fixed inset-0 -z-10" : "absolute inset-0"}`}
      style={{ background: theme.pageBackground, backgroundColor: solid }}
      aria-hidden="true"
    >
      <ThemeArtwork
        layers={theme.artwork}
        scale={mode === "page" ? ARTWORK_SCALE_PAGE : ARTWORK_SCALE_PREVIEW}
      />
      {theme.glowSpots.map((spot, i) => (
        <div
          key={i}
          className="absolute rounded-full blur-3xl"
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
          className="absolute inset-0"
          style={{ backgroundImage: theme.watermarkPattern, backgroundRepeat: "repeat" }}
        />
      )}
    </div>
  );
}

export function themedTitleStyle(theme: ShareTheme, layout: LayoutStyle): CSSProperties {
  return layout.titleUseGradient && theme.dayTitleGradient
    ? {
        backgroundImage: theme.dayTitleGradient,
        backgroundClip: "text",
        WebkitBackgroundClip: "text",
        color: "transparent",
      }
    : { color: theme.dayTitleColor };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function boardHeading(day: PublicDay): { big: string; small: string | null } {
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

type ActiveRow = { id: string; kind: "slot" | "transition" } | null;

type SectionProps = {
  day: PublicDay;
  bandsById: Map<string, PublicBand>;
  activeRow: ActiveRow;
  justAutoFocusedSlotId: string | null;
  isRelevantSlot: (slot: PublicSlot) => boolean;
  showTransitions: boolean;
  onSelectBand: (band: PublicBand) => void;
  theme: ShareTheme;
  layout: LayoutStyle;
};

function activeStatusText(slot: PublicSlot, isBand: boolean): string {
  const label = slot.customLabel ?? "";
  if (isBand) return "出演中！";
  if (/リハーサル|リハ/.test(label)) return "リハーサル中！";
  if (/休憩|ブレイク/.test(label)) return "休憩中！";
  if (/転換/.test(label)) return "転換中！";
  return `${label || "イベント"}中！`;
}

export function ThemedDaySection({
  day,
  bandsById,
  activeRow,
  justAutoFocusedSlotId,
  isRelevantSlot,
  showTransitions,
  onSelectBand,
  theme,
  layout,
}: SectionProps) {
  const rows = buildPamphletRows(day).filter((row) =>
    row.kind === "slot" ? isRelevantSlot(row.slot) : showTransitions,
  );
  if (rows.length === 0) return null;

  // 出演順の番号は、絞り込み(出演者マイページ)に左右されず日の中の通し番号。
  const orders = new Map<string, number>();
  let n = 0;
  for (const s of day.slots) if (s.bandId) orders.set(s.id, ++n);

  const isBoard = layout.structure === "board";
  const grouped = !isBoard && layout.cardBorderWidth === 0 && layout.cardGap <= 4;
  const rowGap = layout.cardGap <= 4 ? layout.cardGap : 10;
  const accent = theme.timeColor;
  const pageSolid = getSetlistPalette(theme).pageFillSolid;
  const activeRing = (on: boolean): CSSProperties =>
    on ? { boxShadow: `0 0 0 3px ${accent}`, position: "relative", zIndex: 1 } : {};

  const heading = boardHeading(day);

  return (
    <section className="mt-6">
      {isBoard ? (
        <div
          className="flex items-center justify-center font-black"
          style={{
            height: 76,
            gap: 12,
            borderRadius: layout.cardRadius,
            background: theme.numberBadgeBackground,
            color: theme.numberBadgeText,
          }}
        >
          <span style={{ fontSize: heading.small ? 44 : 30, lineHeight: 1 }}>{heading.big}</span>
          {heading.small && <span style={{ fontSize: 20, lineHeight: 1 }}>{heading.small}</span>}
        </div>
      ) : (
        <div
          className="flex flex-wrap items-center"
          style={{ gap: 10, justifyContent: layout.titleAlign === "left" ? "flex-start" : "center" }}
        >
          <span
            className="rounded-full font-bold"
            style={{
              fontSize: 15,
              padding: "4px 14px",
              background: theme.numberBadgeBackground,
              color: theme.numberBadgeText,
            }}
          >
            {day.label}
          </span>
          {day.date && (
            <span className="font-medium" style={{ fontSize: 14, color: theme.dateColor }}>
              {day.date}
            </span>
          )}
        </div>
      )}

      <ul className="mt-3 flex flex-col" style={{ gap: rowGap }}>
        {rows.map((row, index) => {
          const isLast = index === rows.length - 1;
          if (row.kind === "transition") {
            const isActive = activeRow?.id === row.gap.id;
            return (
              <li key={row.gap.id}>
                <div
                  id={`pamphlet-slot-${row.gap.id}`}
                  className={`flex items-center ${justAutoFocusedSlotId === row.gap.id ? "pamphlet-auto-focus-pulse" : ""}`}
                  style={{
                    minHeight: isBoard ? 36 : 40,
                    padding: "6px 16px",
                    borderRadius: layout.cardRadius,
                    border: `1px dashed ${theme.cardBorder}`,
                    // 背景イラスト(Stageテーマなど)の上でも文字が読めるよう、ページ色をうっすら敷く。
                    background: `color-mix(in srgb, ${pageSolid} 78%, transparent)`,
                    color: theme.footerColor,
                    fontSize: 13,
                    fontWeight: 600,
                    ...activeRing(isActive),
                  }}
                >
                  {isActive && (
                    <span className="mr-1.5 font-bold" style={{ color: accent }}>
                      ▶ 転換中！
                    </span>
                  )}
                  転換
                </div>
              </li>
            );
          }

          const { slot } = row;
          const band = slot.bandId ? bandsById.get(slot.bandId) : undefined;
          const isActive = activeRow?.id === slot.id;
          const pulse = justAutoFocusedSlotId === slot.id ? "pamphlet-auto-focus-pulse" : "";
          const order = orders.get(slot.id) ?? null;

          // 休憩・集合・リハーサルなどバンド以外の枠: 共有画像と同じく、バンドの
          // カードとは逆の極性の「区切り」として目立たせる。
          if (!band) {
            const label = slot.customLabel ?? "（未定）";
            return (
              <li key={slot.id}>
                <div
                  id={`pamphlet-slot-${slot.id}`}
                  className={`flex items-center ${pulse}`}
                  style={{
                    minHeight: isBoard ? 56 : 52,
                    gap: 10,
                    padding: isBoard ? "0 16px 0 88px" : "10px 16px",
                    justifyContent: isBoard ? "flex-start" : "center",
                    borderRadius: layout.cardRadius,
                    border: isBoard ? "none" : `2px solid ${theme.breakBorder}`,
                    background: theme.breakBg,
                    color: theme.breakText,
                    fontSize: isBoard ? 19 : 17,
                    fontWeight: 800,
                    ...activeRing(isActive),
                  }}
                >
                  {isActive && (
                    <span className="font-bold" style={{ fontSize: 13 }}>
                      ▶ {activeStatusText(slot, false)}
                    </span>
                  )}
                  {label}
                </div>
              </li>
            );
          }

          if (isBoard) {
            return (
              <li key={slot.id}>
                <button
                  id={`pamphlet-slot-${slot.id}`}
                  type="button"
                  onClick={() => onSelectBand(band)}
                  className={`flex w-full items-stretch overflow-hidden text-left ${pulse}`}
                  style={{
                    minHeight: 64,
                    borderRadius: layout.cardRadius,
                    background: theme.cardBg,
                    ...activeRing(isActive),
                  }}
                >
                  <span
                    className="flex shrink-0 items-center justify-center font-bold"
                    style={{
                      width: 76,
                      fontSize: 28,
                      marginRight: 12,
                      background: theme.numberBadgeBackground,
                      color: theme.numberBadgeText,
                    }}
                  >
                    {order}
                  </span>
                  <span className="flex min-w-0 flex-1 items-center" style={{ padding: "8px 0" }}>
                    <span
                      className="font-bold"
                      style={{ fontSize: 21, lineHeight: 1.2, overflowWrap: "anywhere", color: theme.bandNameColor }}
                    >
                      {isActive && (
                        <span className="mr-1.5" style={{ color: accent, fontSize: 14 }}>
                          ▶ {activeStatusText(slot, true)}
                        </span>
                      )}
                      {band.name}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center" style={{ paddingRight: 14, color: accent, fontSize: 14, fontWeight: 600 }}>
                    詳細 ›
                  </span>
                </button>
              </li>
            );
          }

          return (
            <li key={slot.id}>
              <button
                id={`pamphlet-slot-${slot.id}`}
                type="button"
                onClick={() => onSelectBand(band)}
                className={`flex w-full items-center text-left ${pulse}`}
                style={{
                  minHeight: 60,
                  gap: 14,
                  padding: "14px 16px",
                  background: theme.cardBg,
                  borderRadius: layout.cardRadius,
                  border: layout.cardBorderWidth > 0 ? `${layout.cardBorderWidth}px solid ${theme.cardBorder}` : "none",
                  borderBottom: grouped && !isLast ? `1px solid ${theme.cardBorder}` : undefined,
                  boxShadow: layout.cardShadowOverride ?? theme.cardShadow,
                  ...(isActive ? activeRing(true) : {}),
                }}
              >
                {layout.badgeShape === "none" ? (
                  <span
                    className="shrink-0 text-center font-mono font-bold"
                    style={{ width: 28, fontSize: 15, color: theme.timeColor, opacity: 0.75 }}
                  >
                    {order === null ? "" : pad2(order)}
                  </span>
                ) : (
                  <span
                    className={`flex shrink-0 items-center justify-center font-bold ${layout.badgeShape === "circle" ? "rounded-full" : "rounded-lg"}`}
                    style={{
                      width: 38,
                      height: 38,
                      fontSize: 16,
                      background: theme.numberBadgeBackground,
                      color: theme.numberBadgeText,
                    }}
                  >
                    {order}
                  </span>
                )}
                <span className="min-w-0 flex-1 font-bold" style={{ fontSize: 18, color: theme.bandNameColor, overflowWrap: "anywhere" }}>
                  {isActive && (
                    <span className="mr-1.5" style={{ color: accent, fontSize: 14 }}>
                      ▶ {activeStatusText(slot, true)}
                    </span>
                  )}
                  {band.name}
                </span>
                <span className="shrink-0" style={{ fontSize: 13, fontWeight: 600, color: accent }}>
                  詳細 ›
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// 公開ダイアログで、選んだデザインの見え方を確認するための操作できないプレビュー。
// 実際の公開ページと同じ ThemedDaySection を使うので、見た目はそのまま一致する。
export function PamphletDesignPreview({
  data,
  theme,
  layout,
}: {
  data: PublicPamphletDoc;
  theme: ShareTheme;
  layout: LayoutStyle;
}) {
  const bandsById = new Map(data.bands.map((b) => [b.id, b]));
  return (
    <div className="relative overflow-hidden" style={{ color: theme.bandNameColor }}>
      <ThemedBackdrop theme={theme} mode="preview" />
      <div className="relative px-4 pb-6 pt-4">
        <div style={{ textAlign: layout.titleAlign }}>
          <h3 className="font-black leading-tight" style={{ fontSize: 24, ...themedTitleStyle(theme, layout) }}>
            {data.liveName || "タイムテーブル"}
          </h3>
          {(data.venue || data.organizationName) && (
            <p className="mt-0.5" style={{ fontSize: 12, color: theme.dateColor }}>
              {[data.venue, data.organizationName].filter(Boolean).join(" ／ ")}
            </p>
          )}
        </div>
        {data.days.slice(0, 2).map((day) => (
          <ThemedDaySection
            key={day.id}
            day={day}
            bandsById={bandsById}
            activeRow={null}
            justAutoFocusedSlotId={null}
            isRelevantSlot={() => true}
            showTransitions
            onSelectBand={() => {}}
            theme={theme}
            layout={layout}
          />
        ))}
      </div>
    </div>
  );
}
