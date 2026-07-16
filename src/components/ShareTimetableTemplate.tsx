import type { Band, TimetableDay } from "../types";

// A purely presentational, non-interactive render of a day's timetable,
// designed to be captured as a single shareable PNG (Discord/LINE/print) —
// completely separate from the editing UI in DayPanel/SlotCard, which has
// scrollbars, drag handles, and buttons that have no place in a shared
// image. Width is fixed at a mobile-friendly 1080px; height grows with
// content but the font/spacing scale shrinks as the band count climbs past
// what comfortably fits a single portrait screen, so a packed day still
// renders as one clean image instead of endlessly stretching.
const CANVAS_WIDTH = 1080;
// Rough pivot point: at this many visible rows (bands + breaks), scale is
// 1 and the image lands close to a 9:16 (1080x1920) portrait canvas. Fewer
// rows just leave more breathing room; more rows shrink everything down
// together, floored at MIN_SCALE so text never gets crushed illegibly.
const BASE_ROWS_AT_SCALE_1 = 11;
const MIN_SCALE = 0.55;

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

type Props = { day: TimetableDay; bands: Band[] };

export function ShareTimetableTemplate({ day, bands }: Props) {
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
      style={{ width: CANVAS_WIDTH }}
      className="relative overflow-hidden bg-gradient-to-b from-[#0b0a1f] via-[#161334] to-[#0a0912] p-12 text-white"
    >
      {/* Ambient glow accents — purely decorative, evoke a live-venue lighting rig */}
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-indigo-600/25 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 top-64 h-80 w-80 rounded-full bg-fuchsia-600/20 blur-3xl" />

      <div className="relative flex flex-col" style={{ gap: 40 * scale }}>
        <header className="flex flex-col items-center text-center">
          <span
            className="font-semibold tracking-[0.35em] text-indigo-300/80"
            style={{ fontSize: 22 * scale }}
          >
            LIVE TIMETABLE
          </span>
          <h1
            className="mt-2 bg-gradient-to-r from-indigo-300 via-white to-fuchsia-300 bg-clip-text font-black leading-none text-transparent"
            style={{ fontSize: 96 * scale }}
          >
            {day.label}
          </h1>
          {dateLabel && (
            <p
              className="mt-3 font-medium text-slate-300"
              style={{ fontSize: 30 * scale }}
            >
              {dateLabel}
            </p>
          )}
          <div
            className="mt-6 rounded-full bg-gradient-to-r from-transparent via-indigo-400/70 to-transparent"
            style={{ height: 2, width: 320 * scale }}
          />
        </header>

        <div className="flex flex-col" style={{ gap: 14 * scale }}>
          {visibleSlots.map((slot) => {
            const band = slot.bandId ? bandMap.get(slot.bandId) : undefined;
            if (band) {
              order++;
              const shownSetlist = band.setlist.slice(0, 3);
              const extraSongs = band.setlist.length - shownSetlist.length;
              return (
                <div
                  key={slot.id}
                  className="flex items-center rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm"
                  style={{ gap: 20 * scale, padding: 22 * scale }}
                >
                  <div
                    className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-fuchsia-500 font-bold text-white shadow-lg shadow-indigo-950/40"
                    style={{
                      width: 52 * scale,
                      height: 52 * scale,
                      fontSize: 22 * scale,
                    }}
                  >
                    {order}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div
                      className="flex items-baseline"
                      style={{ gap: 12 * scale }}
                    >
                      <span
                        className="shrink-0 font-mono font-semibold text-indigo-300"
                        style={{ fontSize: 22 * scale }}
                      >
                        {slot.startTime}-{slot.endTime}
                      </span>
                      <span
                        className="truncate font-bold text-white"
                        style={{ fontSize: 30 * scale }}
                      >
                        {band.name}
                      </span>
                      {band.hasSync && (
                        <span
                          className="shrink-0 rounded-full border border-violet-400/40 bg-violet-500/15 font-semibold tracking-wide text-violet-200"
                          style={{
                            fontSize: 14 * scale,
                            padding: `${3 * scale}px ${10 * scale}px`,
                          }}
                        >
                          ⚡ SYNC
                        </span>
                      )}
                      {band.hasKeyboard && (
                        <span
                          className="shrink-0 rounded-full border border-sky-400/40 bg-sky-500/15 font-semibold tracking-wide text-sky-200"
                          style={{
                            fontSize: 14 * scale,
                            padding: `${3 * scale}px ${10 * scale}px`,
                          }}
                        >
                          🎹 KEY
                        </span>
                      )}
                    </div>
                    {shownSetlist.length > 0 && (
                      <p
                        className="mt-1 truncate font-light italic text-slate-400"
                        style={{ fontSize: 17 * scale }}
                      >
                        ♪ {shownSetlist.join(" / ")}
                        {extraSongs > 0 ? ` +${extraSongs}` : ""}
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
                className="flex items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.015] text-slate-400"
                style={{ gap: 14 * scale, padding: 14 * scale }}
              >
                <span
                  className="font-mono"
                  style={{ fontSize: 16 * scale }}
                >
                  {slot.startTime}-{slot.endTime}
                </span>
                <span
                  className="tracking-wide"
                  style={{ fontSize: 16 * scale }}
                >
                  {slot.customLabel}
                </span>
              </div>
            );
          })}
        </div>

        <footer
          className="text-center text-slate-500"
          style={{ fontSize: 15 * scale, marginTop: 8 * scale }}
        >
          軽音ライブ タイムテーブル作成
        </footer>
      </div>
    </div>
  );
}
