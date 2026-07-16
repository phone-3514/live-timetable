import type { Band, TimetableDay, TimetableSlot } from "../types";
import { THEMES } from "../utils/shareThemes";
import type { ThemeId } from "../utils/shareThemes";

// A purely presentational, non-interactive render of a day's timetable,
// designed to be captured as a single shareable PNG (Discord/LINE/print) —
// completely separate from the editing UI in DayPanel/SlotCard, which has
// scrollbars, drag handles, and buttons that have no place in a shared
// image.
//
// Readability comes first, the same way the live UI now works: rather than
// stacking every slot into one ever-taller column and shrinking text (or
// forcing a portrait aspect ratio), slots wrap into a fixed number of rows
// per column and new columns appear as needed. Width grows with band
// count instead of font size shrinking — the result naturally lands
// somewhere around a landscape/poster ratio instead of a long scrolling
// strip, and every row stays at full readable size regardless of how
// packed the day is.
export const CANVAS_PADDING = 64;
const COLUMN_WIDTH = 580;
const COLUMN_GAP = 28;
const MAX_SETLIST_SONGS = 5;
// Rough estimates used only to pick a column count that lands somewhere
// near a landscape/poster ratio — not exact (a wrapped setlist can make a
// real row taller), just enough to stop a fixed rows-per-column from
// either stacking a handful of bands into a tall strip (too few columns)
// or stretching a packed day into an unusably panoramic banner (too many).
const EST_HEADER_HEIGHT = 300;
const EST_FOOTER_HEIGHT = 60;
const EST_ROW_HEIGHT = 130;
const TARGET_ASPECT = 1.7; // roughly 16:9

function pickColumnCount(totalRows: number): number {
  if (totalRows <= 1) return 1;
  let best = 1;
  let bestDiff = Infinity;
  for (let cols = 1; cols <= totalRows; cols++) {
    const rows = Math.ceil(totalRows / cols);
    const width = CANVAS_PADDING * 2 + COLUMN_WIDTH * cols + COLUMN_GAP * (cols - 1);
    const height = EST_HEADER_HEIGHT + rows * EST_ROW_HEIGHT + EST_FOOTER_HEIGHT;
    const diff = Math.abs(width / height - TARGET_ASPECT);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = cols;
    }
  }
  return best;
}

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

  // Column-major chunking, same idea as the live UI: column 0 gets the
  // first N slots top-to-bottom, column 1 the next batch, and so on — the
  // canvas gains a column instead of gaining height. The column count
  // (and so rows-per-column) adapts to the band count so the image stays
  // roughly landscape-shaped whether there are 4 bands or 40.
  const columnCount = pickColumnCount(visibleSlots.length);
  const rowsPerColumn = Math.ceil(visibleSlots.length / columnCount) || 1;
  const columns: TimetableSlot[][] = [];
  for (let i = 0; i < visibleSlots.length; i += rowsPerColumn) {
    columns.push(visibleSlots.slice(i, i + rowsPerColumn));
  }
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
                                  className="shrink-0 rounded-full border font-semibold tracking-wide"
                                  style={{
                                    fontSize: 13,
                                    padding: "3px 10px",
                                    background: theme.syncBadge.bg,
                                    borderColor: theme.syncBadge.border,
                                    color: theme.syncBadge.text,
                                  }}
                                >
                                  ⚡ SYNC
                                </span>
                              )}
                              {band.hasKeyboard && (
                                <span
                                  className="shrink-0 rounded-full border font-semibold tracking-wide"
                                  style={{
                                    fontSize: 13,
                                    padding: "3px 10px",
                                    background: theme.keyBadge.bg,
                                    borderColor: theme.keyBadge.border,
                                    color: theme.keyBadge.text,
                                  }}
                                >
                                  🎹 KEY
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
