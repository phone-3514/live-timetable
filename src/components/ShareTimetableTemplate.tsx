import type { Band, TimetableDay } from "../types";
import { THEMES } from "../utils/shareThemes";
import type { ThemeId } from "../utils/shareThemes";

// A purely presentational, non-interactive render of a day's timetable,
// designed to be captured as a single shareable PNG (Discord/LINE/print) —
// completely separate from the editing UI in DayPanel/SlotCard, which has
// scrollbars, drag handles, and buttons that have no place in a shared
// image.
//
// Readability comes first: text wraps instead of being forced onto one
// line and shrunk to fit, so the canvas is wide enough to give long song
// titles room, and height simply grows with content rather than being
// squeezed into a fixed target. The row-count scale below only kicks in
// for genuinely packed days, and even then stops well short of crushing
// text illegibly.
export const CANVAS_WIDTH = 1200;
// Row count beyond which the scale starts easing down — raised well past
// a typical day's band count (previously 11) so shrinking is the
// exception, not the default behavior.
const BASE_ROWS_AT_SCALE_1 = 16;
// Floor is much higher than before (was 0.55) — text should never get
// crushed, so a very packed day grows taller instead of shrinking further.
const MIN_SCALE = 0.8;
const MAX_SETLIST_SONGS = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
  const scale = clamp(
    BASE_ROWS_AT_SCALE_1 / Math.max(visibleSlots.length, BASE_ROWS_AT_SCALE_1),
    MIN_SCALE,
    1,
  );
  const dateLabel = formatDate(day.date);

  let order = 0;

  return (
    <div
      style={{ width: CANVAS_WIDTH, background: theme.pageBackground }}
      className="relative overflow-hidden p-14"
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

      <div className="relative flex flex-col" style={{ gap: 44 * scale }}>
        <header className="flex flex-col items-center text-center">
          <span
            className="font-semibold tracking-[0.35em]"
            style={{ fontSize: 24 * scale, color: theme.kickerColor }}
          >
            LIVE TIMETABLE
          </span>
          <h1
            className="mt-2 font-black leading-none"
            style={{
              fontSize: 108 * scale,
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
            <p
              className="mt-3 font-medium"
              style={{ fontSize: 32 * scale, color: theme.dateColor }}
            >
              {dateLabel}
            </p>
          )}
          <div
            className="mt-6 rounded-full"
            style={{ height: 2, width: 360 * scale, background: theme.dividerBackground }}
          />
        </header>

        <div className="flex flex-col" style={{ gap: 18 * scale }}>
          {visibleSlots.map((slot) => {
            const band = slot.bandId ? bandMap.get(slot.bandId) : undefined;
            if (band) {
              order++;
              const shownSetlist = band.setlist.slice(0, MAX_SETLIST_SONGS);
              const extraSongs = band.setlist.length - shownSetlist.length;
              return (
                <div
                  key={slot.id}
                  className="flex items-start rounded-2xl border"
                  style={{
                    gap: 24 * scale,
                    padding: 26 * scale,
                    background: theme.cardBg,
                    borderColor: theme.cardBorder,
                    boxShadow: theme.cardShadow,
                  }}
                >
                  <div
                    className="flex shrink-0 items-center justify-center rounded-full font-bold"
                    style={{
                      width: 58 * scale,
                      height: 58 * scale,
                      fontSize: 24 * scale,
                      background: theme.numberBadgeBackground,
                      color: theme.numberBadgeText,
                    }}
                  >
                    {order}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline" style={{ gap: 14 * scale }}>
                      <span
                        className="shrink-0 font-mono font-semibold"
                        style={{ fontSize: 24 * scale, color: theme.timeColor }}
                      >
                        {slot.startTime}-{slot.endTime}
                      </span>
                      <span
                        className="break-words font-bold"
                        style={{ fontSize: 34 * scale, color: theme.bandNameColor }}
                      >
                        {band.name}
                      </span>
                      {band.hasSync && (
                        <span
                          className="shrink-0 rounded-full border font-semibold tracking-wide"
                          style={{
                            fontSize: 15 * scale,
                            padding: `${4 * scale}px ${12 * scale}px`,
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
                            fontSize: 15 * scale,
                            padding: `${4 * scale}px ${12 * scale}px`,
                            background: theme.keyBadge.bg,
                            borderColor: theme.keyBadge.border,
                            color: theme.keyBadge.text,
                          }}
                        >
                          🎹 KEY
                        </span>
                      )}
                    </div>
                    {shownSetlist.length > 0 && (
                      <p
                        className="font-light"
                        style={{
                          marginTop: 6 * scale,
                          fontSize: 19 * scale,
                          lineHeight: 1.6,
                          color: theme.setlistColor,
                          fontStyle: theme.setlistItalic ? "italic" : "normal",
                          // Word-wrap naturally instead of being forced onto
                          // one line and truncated — long setlists now flow
                          // onto multiple lines at full readable size.
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

            // Non-band row (休憩・集合・リハーサルなど) — deliberately quieter
            // than a band row so the real lineup stays visually dominant.
            return (
              <div
                key={slot.id}
                className="flex items-center justify-center rounded-2xl border border-dashed"
                style={{
                  gap: 16 * scale,
                  padding: 16 * scale,
                  borderColor: theme.breakBorder,
                  background: theme.breakBg,
                  color: theme.breakText,
                }}
              >
                <span className="font-mono" style={{ fontSize: 17 * scale }}>
                  {slot.startTime}-{slot.endTime}
                </span>
                <span className="tracking-wide" style={{ fontSize: 17 * scale }}>
                  {slot.customLabel}
                </span>
              </div>
            );
          })}
        </div>

        <footer
          className="text-center"
          style={{ fontSize: 16 * scale, marginTop: 8 * scale, color: theme.footerColor }}
        >
          軽音ライブ タイムテーブル作成
        </footer>
      </div>
    </div>
  );
}
