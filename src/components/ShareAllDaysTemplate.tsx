import type { CSSProperties } from "react";
import type { Band, TimetableDay } from "../types";
import { LAYOUTS, THEMES } from "../utils/shareThemes";
import type { LayoutId, ThemeId } from "../utils/shareThemes";
import type { EventInfo } from "../store/useAppStore";
import {
  CANVAS_PADDING,
  COLUMN_GAP,
  COLUMN_WIDTH,
  ShareTimetableColumns,
  formatDate,
  getDayColumns,
} from "./ShareTimetableTemplate";

// Gap between one day's block and the next. Deliberately not the same as
// the double CANVAS_PADDING a naive "place two single-day templates side
// by side" approach produces (each with its own background) — that read
// as an ugly seam down the middle. A single shared canvas/background below
// removes the seam entirely; this gap is just breathing room between two
// day-blocks that both sit on that one background.
const DAY_SECTION_GAP = 56;
// A bit more prominent than the small in-header day pill the single-day
// template uses (that one sits quietly next to a big title it shares the
// header with) — this is the *only* place each day's identity appears in
// the combined image, standing alone above that day's own columns, so it
// needs to read clearly on its own.
const DAY_HEADING_FONT_SIZE = 30;

type Props = {
  days: TimetableDay[];
  bands: Band[];
  themeId: ThemeId;
  eventInfo: EventInfo;
  layoutId?: LayoutId;
};

// All days combined into a single shareable PNG: one shared header/footer
// and one continuous background, with each day's own two-column slot list
// (ShareTimetableColumns — identical rendering to the single-day template)
// laid out side by side underneath its own prominent day label. See
// ShareTimetableTemplate.tsx for the per-day column rendering this reuses
// verbatim, and DAY_SECTION_GAP above for why this isn't just several
// single-day templates placed edge to edge.
export function ShareAllDaysTemplate({ days, bands, themeId, eventInfo, layoutId = "classic" }: Props) {
  const theme = THEMES[themeId];
  const layout = LAYOUTS[layoutId];
  const headerAlignClass = layout.titleAlign === "left" ? "items-start text-left" : "items-center text-center";
  const headerJustifyClass = layout.titleAlign === "left" ? "justify-start" : "justify-center";
  const titleColorStyle: CSSProperties =
    layout.titleUseGradient && theme.dayTitleGradient
      ? {
          backgroundImage: theme.dayTitleGradient,
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          color: "transparent",
        }
      : { color: theme.dayTitleColor };

  const daySections = days.map((day) => ({
    day,
    columnCount: Math.max(getDayColumns(day).length, 1),
    dateLabel: formatDate(day.date),
  }));

  // A single date when there's only one dated day, a range when several —
  // the shared header has room for one date line, not one per day.
  const datedLabels = daySections.map((s) => s.dateLabel).filter((d): d is string => d !== null);
  const combinedDateLabel =
    datedLabels.length === 0
      ? null
      : datedLabels.length === 1
        ? datedLabels[0]
        : `${datedLabels[0]} 〜 ${datedLabels[datedLabels.length - 1]}`;

  // No live name set is the one case the single-day template falls back to
  // day.label/date for (see its own comment) — there's no single day here
  // to fall back to, so every day's label strung together is the closest
  // equivalent that's still always defined.
  const title = eventInfo.liveName || days.map((d) => d.label).join(" ・ ");

  const contentWidth =
    daySections.reduce((sum, s) => sum + COLUMN_WIDTH * s.columnCount + COLUMN_GAP * (s.columnCount - 1), 0) +
    DAY_SECTION_GAP * Math.max(daySections.length - 1, 0);
  const canvasWidth = CANVAS_PADDING * 2 + contentWidth;

  return (
    <div
      style={{ width: canvasWidth, background: theme.pageBackground, padding: CANVAS_PADDING }}
      className="relative overflow-hidden"
    >
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

      <div className="relative flex flex-col" style={{ gap: 36 }}>
        <header className={`flex flex-col ${headerAlignClass}`}>
          <span
            className="font-semibold tracking-[0.35em]"
            style={{ fontSize: 24, color: theme.kickerColor }}
          >
            LIVE TIMETABLE
          </span>
          <h1 className="mt-2 font-black leading-tight" style={{ fontSize: 80, ...titleColorStyle }}>
            {title}
          </h1>
          {combinedDateLabel && (
            <p className="mt-3 font-medium" style={{ fontSize: 22, color: theme.dateColor }}>
              {combinedDateLabel}
            </p>
          )}
          {eventInfo.venue && (
            <div className={`mt-2 flex flex-row items-center ${headerJustifyClass}`} style={{ gap: 6 }}>
              <span style={{ fontSize: 20, lineHeight: 1 }}>📍</span>
              <span
                className="font-medium tracking-wide"
                style={{ fontSize: 20, color: theme.dateColor, whiteSpace: "nowrap" }}
              >
                {eventInfo.venue}
              </span>
            </div>
          )}
          {layout.headerRuleStyle !== "none" && (
            <div
              className={layout.headerRuleStyle === "pill" ? "mt-5 rounded-full" : "mt-5 w-full"}
              style={{
                height: layout.headerRuleStyle === "pill" ? 2 : 1,
                width: layout.headerRuleStyle === "pill" ? 320 : "100%",
                background: theme.dividerBackground,
              }}
            />
          )}
        </header>

        <div className="flex items-start" style={{ gap: DAY_SECTION_GAP }}>
          {daySections.map(({ day, dateLabel }) => (
            <div key={day.id} className="flex shrink-0 flex-col items-center" style={{ gap: 20 }}>
              <div className="flex flex-col items-center">
                <span
                  className="rounded-full font-bold"
                  style={{
                    fontSize: DAY_HEADING_FONT_SIZE,
                    padding: "8px 28px",
                    background: theme.numberBadgeBackground,
                    color: theme.numberBadgeText,
                  }}
                >
                  {day.label}
                </span>
                {dateLabel && (
                  <span className="mt-2 font-medium" style={{ fontSize: 16, color: theme.dateColor }}>
                    {dateLabel}
                  </span>
                )}
              </div>
              <ShareTimetableColumns day={day} bands={bands} theme={theme} layout={layout} />
            </div>
          ))}
        </div>

        <footer className="text-center">
          {eventInfo.organizationName && (
            <p
              className="font-semibold tracking-wide"
              style={{ fontSize: 19, color: theme.dateColor }}
            >
              {eventInfo.organizationName}
            </p>
          )}
          <p
            style={{
              fontSize: 14,
              marginTop: eventInfo.organizationName ? 4 : 0,
              color: theme.footerColor,
            }}
          >
            軽音ライブ タイムテーブル作成
          </p>
        </footer>
      </div>
    </div>
  );
}
