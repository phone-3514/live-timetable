import type { TimetableDay } from "../types";
import type { EventInfo } from "../store/useAppStore";
import type { SetlistBandEntry } from "../utils/setlistExport";
import { THEMES, getSetlistPalette } from "../utils/shareThemes";
import type { ThemeId } from "../utils/shareThemes";

// A4 at 96dpi for the single-column (PDF/print) layout. The multi-column
// (PNG) layout ignores this and sizes itself from COLUMN_WIDTH * columns
// instead — see SetlistExportTemplate's columns prop.
export const PAGE_WIDTH = 794;
const PAGE_PADDING = 32;
const COLUMN_WIDTH = 380;
const COLUMN_GAP = 20;

type Props = {
  day: TimetableDay;
  eventInfo: EventInfo;
  entries: SetlistBandEntry[];
  /** 1 (default) = single portrait column at A4 print width, for the PDF
   * export. 2-3 = landscape, that many side-by-side columns instead, for
   * the PNG export — so a long day grows wider rather than indefinitely
   * taller. Entries are split sequentially (1-10 in col 1, 11-20 in col
   * 2, ...); each column keeps entries in performance order, just as a
   * newspaper-style column layout would. */
  columns?: number;
  /** Shares the same theme system as the Timetable share-image export
   * (shareThemes.ts) — see getSetlistPalette for how a ShareTheme's fields
   * map onto this table's color roles. Defaults to "standard" (white
   * background, print-friendly), same as before themes existed here. */
  themeId?: ThemeId;
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

// The header + row rendering is identical whether it's the single wide
// column (PDF) or one of several narrower side-by-side columns (PNG) — only
// the container width around it differs, so this is shared rather than
// duplicated per layout mode.
function SetlistTable({
  entries,
  COLORS,
}: {
  entries: SetlistBandEntry[];
  COLORS: ReturnType<typeof getSetlistPalette>;
}) {
  return (
    <div>
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
          key={entry.order}
          data-setlist-row="true"
          style={{
            display: "grid",
            gridTemplateColumns: "60px 1fr 1fr",
            gap: 10,
            padding: "7px 8px",
            background: i % 2 === 1 ? COLORS.zebra : "transparent",
            borderBottom: `1px solid ${COLORS.rowBorder}`,
            // html-to-image screenshots the DOM into a canvas — it has no
            // concept of print pagination, so these CSS break properties
            // are inert for the PDF export path (kept for correctness/if
            // a user prints this DOM directly some other way). The PDF
            // export instead measures each [data-setlist-row] element's
            // actual pixel bounds (SetlistExportModal.handleDownloadPdf)
            // and only cuts a page between rows, never through one.
            breakInside: "avoid",
            pageBreakInside: "avoid",
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
  );
}

export function SetlistExportTemplate({
  day,
  eventInfo,
  entries,
  columns = 1,
  themeId = "standard",
}: Props) {
  const COLORS = getSetlistPalette(THEMES[themeId]);
  const dateLabel = formatDate(day.date);
  const isMultiColumn = columns > 1;
  const contentWidth = isMultiColumn
    ? columns * COLUMN_WIDTH + (columns - 1) * COLUMN_GAP
    : PAGE_WIDTH - PAGE_PADDING * 2;

  // Sequential split — entries 1..k in column 1, k+1..2k in column 2, etc.,
  // like a newspaper. Each entry already carries its own global
  // performance-order number (computeSetlistEntries), so no renumbering is
  // needed when it lands in a later column.
  const columnGroups: SetlistBandEntry[][] = isMultiColumn
    ? Array.from({ length: columns }, (_, ci) => {
        const chunkSize = Math.ceil(entries.length / columns);
        return entries.slice(ci * chunkSize, (ci + 1) * chunkSize);
      }).filter((g) => g.length > 0)
    : [entries];

  return (
    <div
      style={{
        position: "relative",
        // z-index: 0 (not just position: relative) is load-bearing: it's
        // what makes this div its OWN stacking context. Without it, the
        // watermark's z-index: -1 below resolves against a much higher
        // ancestor instead of this element, which puts it behind THIS
        // div's own opaque background too — i.e. fully hidden — rather
        // than behind just the header/table content sitting on top of it.
        zIndex: 0,
        width: contentWidth + PAGE_PADDING * 2,
        padding: PAGE_PADDING,
        background: COLORS.pageBackground,
        fontFamily:
          '"Hiragino Sans", "Noto Sans JP", "Yu Gothic", system-ui, sans-serif',
        overflow: "hidden",
      }}
    >
      {COLORS.watermarkPattern && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: COLORS.watermarkPattern, backgroundRepeat: "repeat", zIndex: -1 }}
        />
      )}
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
      ) : isMultiColumn ? (
        <div style={{ display: "flex", alignItems: "flex-start", gap: COLUMN_GAP }}>
          {columnGroups.map((group, gi) => (
            <div key={gi} style={{ width: COLUMN_WIDTH, flexShrink: 0 }}>
              <SetlistTable entries={group} COLORS={COLORS} />
            </div>
          ))}
        </div>
      ) : (
        <SetlistTable entries={entries} COLORS={COLORS} />
      )}

      <footer style={{ marginTop: 16, textAlign: "center", fontSize: 8.5, color: COLORS.kicker }}>
        軽音ライブ タイムテーブル作成
      </footer>
    </div>
  );
}
