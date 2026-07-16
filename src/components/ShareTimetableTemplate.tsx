import type { Band, TimetableDay, TimetableSlot } from "../types";
import { THEMES } from "../utils/shareThemes";
import type { ThemeId } from "../utils/shareThemes";

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

type Props = { day: TimetableDay; bands: Band[]; themeId: ThemeId };

export function ShareTimetableTemplate({ day, bands, themeId }: Props) {
  const theme = THEMES[themeId];
  const bandMap = new Map(bands.map((b) => [b.id, b]));
  // Fully-empty "still to be filled" slots are a working-draft artifact —
  // they carry no information for an audience, so the shared image only
  // shows rows that are actually decided.
  const visibleSlots = day.slots.filter(
    (s) => s.bandId !== null || s.customLabel !== null,
  );
  const dateLabel = formatDate(day.date);

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

      <div className="relative flex flex-col" style={{ gap: 36 }}>
        <header className="flex flex-col items-center text-center">
          <span
            className="font-semibold tracking-[0.35em]"
            style={{ fontSize: 24, color: theme.kickerColor }}
          >
            LIVE TIMETABLE
          </span>
          <h1
            className="mt-2 font-black leading-none"
            style={{
              fontSize: 96,
              ...(theme.dayTitleGradient
                ? {
                    backgroundImage: theme.dayTitleGradient,
                    backgroundClip: "text",
                    WebkitBackgroundClip: "text",
                    color: "transparent",
                  }
                : { color: theme.dayTitleColor }),
            }}
          >
            {day.label}
          </h1>
          {dateLabel && (
            <p className="mt-3 font-medium" style={{ fontSize: 28, color: theme.dateColor }}>
              {dateLabel}
            </p>
          )}
          <div
            className="mt-5 rounded-full"
            style={{ height: 2, width: 320, background: theme.dividerBackground }}
          />
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
                style={{ width: COLUMN_WIDTH, gap: 16 }}
              >
                {column.map((slot) => {
                  const band = slot.bandId ? bandMap.get(slot.bandId) : undefined;
                  if (band) {
                    const shownSetlist = band.setlist.slice(0, MAX_SETLIST_SONGS);
                    const extraSongs = band.setlist.length - shownSetlist.length;
                    return (
                      <div
                        key={slot.id}
                        className="flex items-start rounded-2xl border"
                        style={{
                          gap: 18,
                          padding: 20,
                          background: theme.cardBg,
                          borderColor: theme.cardBorder,
                          boxShadow: theme.cardShadow,
                        }}
                      >
                        <div
                          className="flex shrink-0 items-center justify-center rounded-full font-bold"
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
                            <p
                              className="font-light"
                              style={{
                                marginTop: 6,
                                fontSize: 16,
                                lineHeight: 1.55,
                                color: theme.setlistColor,
                                fontStyle: theme.setlistItalic ? "italic" : "normal",
                                // Word-wrap naturally instead of being
                                // forced onto one line and truncated.
                                overflowWrap: "break-word",
                              }}
                            >
                              ♪ {shownSetlist.join(" / ")}
                              {extraSongs > 0 ? ` 他${extraSongs}曲` : ""}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  }

                  // Non-band row (休憩・集合・リハーサルなど) — deliberately
                  // quieter than a band row so the real lineup stays
                  // visually dominant.
                  return (
                    <div
                      key={slot.id}
                      className="flex items-center justify-center rounded-2xl border border-dashed"
                      style={{
                        gap: 12,
                        padding: 14,
                        borderColor: theme.breakBorder,
                        background: theme.breakBg,
                        color: theme.breakText,
                      }}
                    >
                      <span className="font-mono" style={{ fontSize: 15 }}>
                        {slot.startTime}-{slot.endTime}
                      </span>
                      <span className="tracking-wide" style={{ fontSize: 15 }}>
                        {slot.customLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        <footer className="text-center" style={{ fontSize: 15, color: theme.footerColor }}>
          軽音ライブ タイムテーブル作成
        </footer>
      </div>
    </div>
  );
}
