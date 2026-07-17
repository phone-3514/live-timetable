import type { TimetableDay } from "../types";
import type { EventInfo } from "../store/useAppStore";
import type { SetlistBandEntry } from "../utils/setlistExport";

// A4 at 96dpi — this is a *print* document (unlike ShareTimetableTemplate,
// which is a social-share image with no fixed real-world size), so the
// canvas width is pinned to a page width rather than to column count. The
// export step (SetlistExportModal) slices the resulting tall image into
// real A4-height pages for the PDF option; this component only renders one
// continuous flow and doesn't know or care about page breaks itself.
const PAGE_WIDTH = 794;
const PAGE_PADDING = 32;

type Props = {
  day: TimetableDay;
  eventInfo: EventInfo;
  entries: SetlistBandEntry[];
};

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

// Muted slate/navy on white — chosen for print (no ink-heavy dark
// backgrounds) and to stay legible if printed in black & white, unlike the
// share image's saturated theme palette.
const COLORS = {
  kicker: "#64748b", // slate-500
  title: "#1e293b", // slate-800
  subtitle: "#475569", // slate-600
  headerBg: "#1e293b", // slate-800
  headerText: "#e2e8f0", // slate-200
  rowBorder: "#e2e8f0", // slate-200
  zebra: "#f8fafc", // slate-50
  bandName: "#0f172a", // slate-900
  song: "#334155", // slate-700
  memberName: "#1e293b", // slate-800
  chipBg: "#eef2f7",
  chipText: "#475569",
  orderBadgeBg: "#1e293b",
  orderBadgeText: "#f8fafc",
};

export function SetlistExportTemplate({ day, eventInfo, entries }: Props) {
  const dateLabel = formatDate(day.date);

  return (
    <div
      style={{
        width: PAGE_WIDTH,
        padding: PAGE_PADDING,
        background: "#ffffff",
        fontFamily:
          '"Hiragino Sans", "Noto Sans JP", "Yu Gothic", system-ui, sans-serif',
      }}
    >
      <header style={{ marginBottom: 18 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.25em",
            color: COLORS.kicker,
          }}
        >
          SETLIST
        </div>
        <h1
          style={{
            marginTop: 4,
            fontSize: 24,
            fontWeight: 800,
            color: COLORS.title,
            lineHeight: 1.2,
          }}
        >
          {eventInfo.liveName || "出演スケジュール"}
        </h1>
        <p style={{ marginTop: 4, fontSize: 12.5, color: COLORS.subtitle }}>
          {day.label}
          {dateLabel ? `　${dateLabel}` : ""}
          {eventInfo.venue ? `　@ ${eventInfo.venue}` : ""}
        </p>
        <div style={{ marginTop: 10, height: 2, background: COLORS.rowBorder }} />
      </header>

      {entries.length === 0 ? (
        <p style={{ fontSize: 13, color: COLORS.subtitle, textAlign: "center", padding: "24px 0" }}>
          まだ配置されたバンドがありません
        </p>
      ) : (
        <div>
          {/* Column header row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "60px 1fr 1fr",
              gap: 10,
              background: COLORS.headerBg,
              color: COLORS.headerText,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              padding: "5px 8px",
              borderRadius: 4,
            }}
          >
            <span>時間</span>
            <span>バンド / セットリスト</span>
            <span>メンバー</span>
          </div>

          {entries.map((entry, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "60px 1fr 1fr",
                gap: 10,
                padding: "7px 8px",
                background: i % 2 === 1 ? COLORS.zebra : "transparent",
                borderBottom: `1px solid ${COLORS.rowBorder}`,
                // Rows can't be split cleanly by the canvas-slicing PDF
                // export (it cuts by raw pixel offset, not DOM
                // boundaries) — keeping rows short and uniform is what
                // actually keeps mid-row page breaks rare in practice.
                breakInside: "avoid",
              }}
            >
              {/* Time / order column */}
              <div>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 20,
                    height: 16,
                    borderRadius: 8,
                    background: COLORS.orderBadgeBg,
                    color: COLORS.orderBadgeText,
                    fontSize: 9.5,
                    fontWeight: 700,
                    padding: "0 5px",
                  }}
                >
                  {String(entry.order).padStart(2, "0")}
                </span>
                <div
                  style={{
                    marginTop: 3,
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: COLORS.title,
                    lineHeight: 1.35,
                  }}
                >
                  {entry.startTime || "-"}
                  <br />
                  <span style={{ color: COLORS.subtitle }}>-{entry.endTime || "-"}</span>
                </div>
              </div>

              {/* Band name + setlist column */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.bandName }}>
                  {entry.bandName}
                </div>
                {entry.songs.length > 0 ? (
                  <ol style={{ marginTop: 2, paddingLeft: 0, listStyle: "none" }}>
                    {entry.songs.map((song, si) => (
                      <li
                        key={si}
                        style={{
                          fontSize: 9,
                          lineHeight: 1.45,
                          color: COLORS.song,
                        }}
                      >
                        {si + 1}. {song.title}
                        {song.artist && (
                          <span style={{ color: COLORS.subtitle }}> - {song.artist}</span>
                        )}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div style={{ fontSize: 9, color: COLORS.subtitle }}>未定</div>
                )}
              </div>

              {/* Members column */}
              <div>
                {entry.members.length > 0 ? (
                  entry.members.map((m, mi) => (
                    <div
                      key={mi}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 9,
                        lineHeight: 1.6,
                        color: COLORS.memberName,
                      }}
                    >
                      {m.grade && (
                        <span
                          style={{
                            background: COLORS.chipBg,
                            color: COLORS.chipText,
                            borderRadius: 3,
                            padding: "0 4px",
                            fontSize: 8.5,
                            fontWeight: 600,
                          }}
                        >
                          {m.grade}
                        </span>
                      )}
                      {m.part && (
                        <span
                          style={{
                            background: COLORS.chipBg,
                            color: COLORS.chipText,
                            borderRadius: 3,
                            padding: "0 4px",
                            fontSize: 8.5,
                            fontWeight: 600,
                          }}
                        >
                          {m.part}
                        </span>
                      )}
                      <span>{m.name}</span>
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: 9, color: COLORS.subtitle }}>未定</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <footer style={{ marginTop: 16, textAlign: "center", fontSize: 8.5, color: COLORS.kicker }}>
        軽音ライブ タイムテーブル作成
      </footer>
    </div>
  );
}
