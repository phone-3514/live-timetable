import type { CSSProperties } from "react";
import type { Band, TimetableDay, TimetableSlot } from "../types";
import { LAYOUTS, THEMES } from "../utils/shareThemes";
import type { LayoutId, ThemeId } from "../utils/shareThemes";
import type { EventInfo } from "../store/useAppStore";

// A purely presentational, non-interactive render of a day's timetable,
// designed to be captured as a single shareable PNG (Discord/LINE/print) —
// completely separate from the editing UI in DayPanel/SlotCard, which has
// scrollbars, drag handles, and buttons that have no place in a shared
// image.
//
// Layout mirrors the live UI: always exactly two columns (first half of
// the day's slots on the left, second half on the right), time flowing
// top-to-bottom within each — not an unbounded number of columns that
// grows with band count. That approach produced unusably panoramic images
// for a packed day; a fixed two-column split keeps the canvas a
// consistent, balanced width and simply grows taller for more bands,
// which reads as a normal timetable rather than a wide banner.
export const CANVAS_PADDING = 64;
const COLUMN_WIDTH = 580;
const COLUMN_GAP = 28;
const MAX_SETLIST_SONGS = 5;

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(d);
}

type Props = {
  day: TimetableDay;
  bands: Band[];
  themeId: ThemeId;
  eventInfo: EventInfo;
  // "1日目" is only meaningful information once there's a second day to
  // distinguish it from — for a single-day event it's just clutter next to
  // the event name, so the caller (SharePreviewModal) tells us how many
  // days the event has and this hides the badge when there's only one.
  isSingleDay: boolean;
  /** Independent from `themeId` — see shareThemes.ts's LayoutId doc
   * comment. Defaults to "classic", which reproduces this template's
   * pre-existing rendering exactly (every callsite that existed before
   * this prop was added keeps working with zero visual change). */
  layoutId?: LayoutId;
};

export function ShareTimetableTemplate({
  day,
  bands,
  themeId,
  eventInfo,
  isSingleDay,
  layoutId = "classic",
}: Props) {
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
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  // Fully-empty "still to be filled" slots are a working-draft artifact —
  // they carry no information for an audience, so the shared image only
  // shows rows that are actually decided.
  const visibleSlots = day.slots.filter(
    (s) => s.bandId !== null || s.customLabel !== null,
  );
  const dateLabel = formatDate(day.date);
  const showDayLabel = !isSingleDay;

  const orderById = new Map<string, number>();
  let order = 0;
  for (const slot of visibleSlots) {
    if (slot.bandId) orderById.set(slot.id, ++order);
  }

  // Fixed two-column split, same as the live UI: first half of the day on
  // the left, second half on the right. The canvas width is therefore
  // constant regardless of band count — only the height grows. A single
  // leftover band (odd total) doesn't get a wasted, empty second column.
  const half = Math.ceil(visibleSlots.length / 2);
  const columns: TimetableSlot[][] = [visibleSlots.slice(0, half), visibleSlots.slice(half)].filter(
    (c) => c.length > 0,
  );
  const canvasWidth =
    CANVAS_PADDING * 2 +
    COLUMN_WIDTH * Math.max(columns.length, 1) +
    COLUMN_GAP * Math.max(columns.length - 1, 0);

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
        // Opacity is baked into the SVG's own stroke-opacity (see
        // shareThemes.ts), so this layer just needs to sit above the page
        // background and below the actual content — never intercepting
        // clicks (there are none here, but consistent with every other
        // decorative layer in this template).
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
          {eventInfo.liveName ? (
            <>
              {/* Live name takes the big-title slot when provided — it's
                  the event's actual name, more specific than the generic
                  "Day N" marker, which becomes a secondary pill instead. */}
              <h1
                className="mt-2 font-black leading-tight"
                style={{ fontSize: 80, ...titleColorStyle }}
              >
                {eventInfo.liveName}
              </h1>
              {(showDayLabel || dateLabel) && (
                <div className={`mt-3 flex flex-wrap items-center ${headerJustifyClass}`} style={{ gap: 10 }}>
                  {showDayLabel && (
                    <span
                      className="rounded-full font-bold"
                      style={{
                        fontSize: 20,
                        padding: "4px 16px",
                        background: theme.numberBadgeBackground,
                        color: theme.numberBadgeText,
                      }}
                    >
                      {day.label}
                    </span>
                  )}
                  {dateLabel && (
                    <span className="font-medium" style={{ fontSize: 22, color: theme.dateColor }}>
                      {dateLabel}
                    </span>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              {/* No live name set, so this heading slot has nothing more
                  specific to show than the day marker itself in the
                  multi-day case — but for a single-day event "1日目" would
                  be the *only* heading with nothing to distinguish it from,
                  so the date takes its place when one's been set. If
                  neither a live name nor a date exists for a single-day
                  event, day.label stays as the fallback title rather than
                  leaving the header blank. */}
              <h1
                className="mt-2 font-black leading-none"
                style={{ fontSize: 96, ...titleColorStyle }}
              >
                {showDayLabel || !dateLabel ? day.label : dateLabel}
              </h1>
              {dateLabel && showDayLabel && (
                <p className="mt-3 font-medium" style={{ fontSize: 28, color: theme.dateColor }}>
                  {dateLabel}
                </p>
              )}
            </>
          )}
          {eventInfo.venue && (
            // Plain text here let the browser treat every character as a
            // valid line-break point (the default for CJK text with no
            // white-space/word-break override), so a venue name could
            // wrap mid-word ("薬泉" / "園") with the pin icon left
            // stranded above it. An explicit row with nowrap on the label
            // keeps the icon and full name together on one line; the
            // header has no width constraint tighter than the canvas
            // itself, so there's always room for it to grow into.
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

        {columns.length === 0 ? (
          <p className="text-center" style={{ fontSize: 20, color: theme.footerColor }}>
            まだ配置されたバンドがありません
          </p>
        ) : (
          <div className="flex" style={{ gap: COLUMN_GAP }}>
            {columns.map((column, colIndex) => (
              <div
                key={colIndex}
                className="flex shrink-0 flex-col"
                style={{ width: COLUMN_WIDTH, gap: layout.cardGap }}
              >
                {column.map((slot, slotIndex) => {
                  const band = slot.bandId ? bandMap.get(slot.bandId) : undefined;
                  if (band) {
                    const shownSetlist = band.setlist.slice(0, MAX_SETLIST_SONGS);
                    const extraSongs = band.setlist.length - shownSetlist.length;
                    // Grouped-list layouts (Apple/Notion: cardGap near 0,
                    // no per-card border) use a thin bottom rule between
                    // adjacent rows instead, so rows still read as
                    // separated — but never after the last row in a
                    // column, and never when the layout already has its
                    // own card border (classic/material).
                    const isLastInColumn = slotIndex === column.length - 1;
                    const groupedDivider =
                      layout.cardBorderWidth === 0 && layout.cardGap <= 4 && !isLastInColumn
                        ? `1px solid ${theme.cardBorder}`
                        : "none";
                    return (
                      <div
                        key={slot.id}
                        className="flex items-start"
                        style={{
                          gap: 18,
                          padding: 20,
                          background: theme.cardBg,
                          borderRadius: layout.cardRadius,
                          border: layout.cardBorderWidth > 0 ? `${layout.cardBorderWidth}px solid ${theme.cardBorder}` : "none",
                          borderBottom: groupedDivider !== "none" ? groupedDivider : undefined,
                          boxShadow: layout.cardShadowOverride ?? theme.cardShadow,
                        }}
                      >
                        {layout.badgeShape === "none" ? (
                          <div
                            className="flex shrink-0 items-center justify-center font-mono font-bold"
                            style={{ width: 32, fontSize: 17, color: theme.timeColor, opacity: 0.75 }}
                          >
                            {String(orderById.get(slot.id)).padStart(2, "0")}
                          </div>
                        ) : (
                          <div
                            className={`flex shrink-0 items-center justify-center font-bold ${layout.badgeShape === "circle" ? "rounded-full" : "rounded-lg"}`}
                            style={{
                              width: 46,
                              height: 46,
                              fontSize: 19,
                              background: theme.numberBadgeBackground,
                              color: theme.numberBadgeText,
                            }}
                          >
                            {orderById.get(slot.id)}
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline" style={{ gap: 10 }}>
                            <span
                              className="shrink-0 font-mono font-semibold"
                              style={{ fontSize: 19, color: theme.timeColor }}
                            >
                              {slot.startTime}-{slot.endTime}
                            </span>
                            <span
                              className="break-words font-bold"
                              style={{ fontSize: 26, color: theme.bandNameColor }}
                            >
                              {band.name}
                            </span>
                          </div>
                          {(band.hasSync || band.hasKeyboard) && (
                            <div className="mt-1.5 flex flex-wrap" style={{ gap: 8 }}>
                              {band.hasSync && (
                                <span
                                  className="inline-flex shrink-0 items-center justify-center rounded-full border font-semibold tracking-wide leading-none"
                                  style={{
                                    fontSize: 13,
                                    gap: 4,
                                    padding: "5px 10px 4px",
                                    background: theme.syncBadge.bg,
                                    borderColor: theme.syncBadge.border,
                                    color: theme.syncBadge.text,
                                  }}
                                >
                                  <span>⚡</span>
                                  <span>SYNC</span>
                                </span>
                              )}
                              {band.hasKeyboard && (
                                <span
                                  className="inline-flex shrink-0 items-center justify-center rounded-full border font-semibold tracking-wide leading-none"
                                  style={{
                                    fontSize: 13,
                                    gap: 4,
                                    padding: "5px 10px 4px",
                                    background: theme.keyBadge.bg,
                                    borderColor: theme.keyBadge.border,
                                    color: theme.keyBadge.text,
                                  }}
                                >
                                  <span>🎹</span>
                                  <span>KEY</span>
                                </span>
                              )}
                            </div>
                          )}
                          {shownSetlist.length > 0 && (
                            // One song per line (this is a real DOM render via
                            // html-to-image, so line breaks show up in the
                            // exported PNG) — joining with " / " put every
                            // song's artist right up against the next song's
                            // title with no visual break, making the list
                            // unreadable once a band had more than one song.
                            // Numbering each line makes the song boundary
                            // unambiguous even if two titles happen to share
                            // a word.
                            <div style={{ marginTop: 6 }}>
                              {shownSetlist.map((song, i) => {
                                const slashIndex = song.indexOf("/");
                                const title = slashIndex === -1 ? song : song.slice(0, slashIndex);
                                const artist =
                                  slashIndex === -1 ? "" : song.slice(slashIndex + 1).trim();
                                return (
                                  <p
                                    key={i}
                                    className="font-light"
                                    style={{
                                      fontSize: 16,
                                      lineHeight: 1.55,
                                      color: theme.setlistColor,
                                      fontStyle: theme.setlistItalic ? "italic" : "normal",
                                      overflowWrap: "break-word",
                                    }}
                                  >
                                    {i === 0 ? "♪ " : "　"}
                                    {i + 1}. {title.trim()}
                                    {artist && (
                                      <span style={{ opacity: 0.7 }}>&nbsp;-&nbsp;{artist}</span>
                                    )}
                                  </p>
                                );
                              })}
                              {extraSongs > 0 && (
                                <p
                                  className="font-light"
                                  style={{
                                    fontSize: 14,
                                    color: theme.setlistColor,
                                    opacity: 0.7,
                                  }}
                                >
                                  　他{extraSongs}曲
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }

                  // Non-band row (休憩・集合・リハーサルなど) — styled as a
                  // clear section-divider/milestone rather than a quieter
                  // version of a band card: solid (not dashed) border,
                  // generous padding, and a large, heavily-weighted title
                  // so "休憩" or "写真撮影" reads instantly even at a
                  // glance on a small phone screen. Opposite color polarity
                  // from band cards (solid light background, dark text) on
                  // every theme, including the dark ones, so it's
                  // unmistakably a different kind of row, not a dimmer
                  // band card.
                  return (
                    <div
                      key={slot.id}
                      className="flex items-center justify-center border-2"
                      style={{
                        gap: 14,
                        padding: "18px 16px",
                        borderRadius: layout.cardRadius,
                        borderColor: theme.breakBorder,
                        background: theme.breakBg,
                        boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
                      }}
                    >
                      <span
                        className="font-mono font-bold"
                        style={{ fontSize: 17, color: theme.breakText, opacity: 0.75 }}
                      >
                        {slot.startTime}-{slot.endTime}
                      </span>
                      <span
                        aria-hidden="true"
                        style={{ width: 2, height: 22, background: theme.breakText, opacity: 0.25 }}
                      />
                      <span
                        className="font-black tracking-wide"
                        style={{ fontSize: 23, color: theme.breakText }}
                      >
                        {slot.customLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

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
