import { useEffect, useMemo, useRef, useState } from "react";
import { PamphletThemeToggle } from "./PamphletThemeToggle";
import { useSyncThemeAttribute } from "../hooks/useSyncThemeAttribute";
import { usePamphletCache } from "./usePamphletCache";
import { useActiveSlotId } from "./useActiveSlotId";
import { buildPamphletRows } from "./transitionGaps";
import type { PublicBand, PublicDay, PublicSlot } from "./types";

interface Props {
  circleId: string;
}

// Faint line-art instrument silhouettes, tiled — same technique as
// shareThemes.ts's INSTRUMENTS_WATERMARK (a low-opacity tiled data-URI
// SVG is cheaper and crisper at any zoom than a raster image), but using
// `currentColor` instead of a hardcoded stroke so it reads correctly in
// both light and dark mode: the wrapping element sets `color` from this
// app's own theme tokens, and the browser resolves `currentColor` at
// render time — no separate light/dark SVG needed.
const INSTRUMENTS_BG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 220 220"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><g transform="translate(16,14)"><circle cx="18" cy="50" r="16"/><circle cx="18" cy="27" r="10"/><line x1="18" y1="10" x2="18" y2="-6"/></g><g transform="translate(128,10)"><rect x="4" y="0" width="15" height="24" rx="7"/><path d="M0 18a13 13 0 0 0 26 0"/><line x1="13" y1="31" x2="13" y2="46"/></g><g transform="translate(24,128)"><ellipse cx="28" cy="14" rx="28" ry="9"/><line x1="0" y1="14" x2="0" y2="42"/><line x1="56" y1="14" x2="56" y2="42"/><ellipse cx="28" cy="42" rx="28" ry="9"/></g><g transform="translate(128,140)"><rect x="0" y="0" width="64" height="22"/><line x1="9" y1="0" x2="9" y2="22"/><line x1="18" y1="0" x2="18" y2="15"/><line x1="27" y1="0" x2="27" y2="22"/><line x1="36" y1="0" x2="36" y2="15"/><line x1="45" y1="0" x2="45" y2="22"/><line x1="54" y1="0" x2="54" y2="15"/></g></g></svg>`;
const INSTRUMENTS_BG = `url("data:image/svg+xml,${encodeURIComponent(INSTRUMENTS_BG_SVG)}")`;

function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// The entire public pamphlet route tree lives in this one directory
// (src/pamphlet/) and imports NOTHING from the admin editor beyond two
// deliberately Firebase-free, editing-free primitives: useThemeStore (via
// PamphletThemeToggle) and useSyncThemeAttribute. No dnd-kit, no
// useAppStore, no CSV/Excel/PDF export code, no drag-and-drop, no room
// password gate — this route is read-only by construction, not just by
// omitted buttons, since none of the code that could mutate anything is
// even imported here. See firestore.rules for the matching server-side
// enforcement (this collection has no client write rule at all).
export function PublicPamphletRoot({ circleId }: Props) {
  useSyncThemeAttribute();
  const { data, state, cachedAt, refreshing, refresh } = usePamphletCache(circleId);
  const activeRow = useActiveSlotId(data);
  const [selectedBand, setSelectedBand] = useState<PublicBand | null>(null);
  const [myTimetableBandId, setMyTimetableBandId] = useState<string>("");
  // Set briefly right after the initial auto-scroll-to-now lands, so the
  // "you are here" row gets a one-time attention pulse on top of its
  // steady "出演中" highlight — not a permanently-animating element,
  // which would be distracting for anyone lingering on the page.
  const [justAutoFocusedSlotId, setJustAutoFocusedSlotId] = useState<string | null>(null);

  const bandsById = useMemo(() => {
    const map = new Map<string, PublicBand>();
    for (const b of data?.bands ?? []) map.set(b.id, b);
    return map;
  }, [data]);

  // My Timetable: only the rehearsal/performance rows that mention the
  // selected band. This app has no notion of a rehearsal being formally
  // "linked" to a band beyond the label text, so this matches
  // customLabel text against the band name in addition to bandId — a
  // "○○リハーサル" custom slot naming the band by name still shows up.
  const selectedBandName = myTimetableBandId ? bandsById.get(myTimetableBandId)?.name ?? "" : "";
  const isRelevantSlot = (slot: PublicSlot) => {
    if (!myTimetableBandId) return true;
    if (slot.bandId === myTimetableBandId) return true;
    if (selectedBandName && slot.customLabel?.includes(selectedBandName)) return true;
    return false;
  };

  // Auto-focus the currently-playing band on load — but only ONCE per
  // page load (a ref guard, not a dependency-driven re-trigger), and
  // only when today's device date actually matches one of the event's
  // days: `useActiveSlotId` already only returns non-null when "now" is
  // genuinely inside some slot's time window, but a stale cached
  // pamphlet from a past or future event could otherwise still produce
  // a same-time-of-day coincidence — checking the date explicitly is
  // what makes this "the live event happening today," not "any slot
  // whose HH:MM range happens to contain the current clock time."
  const hasAutoFocusedRef = useRef(false);
  useEffect(() => {
    if (hasAutoFocusedRef.current || !data || !activeRow) return;
    const today = todayIso();
    const isEventToday = data.days.some((d) => d.date === today);
    if (!isEventToday) return;
    hasAutoFocusedRef.current = true;
    const el = document.getElementById(`pamphlet-slot-${activeRow.id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setJustAutoFocusedSlotId(activeRow.id);
    const timer = setTimeout(() => setJustAutoFocusedSlotId(null), 2400);
    return () => clearTimeout(timer);
  }, [data, activeRow]);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-slate-950 pb-8 text-slate-100">
      <PamphletBackground />

      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--glass-border)] bg-slate-900/70 px-4 py-3 backdrop-blur-xl">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-slate-100 md:text-xl">
            {data?.liveName || "タイムテーブル"}
          </h1>
          {(data?.venue || data?.organizationName) && (
            <p className="mt-0.5 text-sm text-slate-400">
              {[data?.venue, data?.organizationName].filter(Boolean).join(" ／ ")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            title="最新の公開情報を再取得します"
            className="flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--glass-border)] bg-[var(--glass-card-bg)] px-3 text-sm font-medium text-slate-300 backdrop-blur-md hover:bg-[var(--glass-card-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {refreshing ? "更新中…" : "🔄 更新"}
          </button>
          <PamphletThemeToggle />
        </div>
      </header>

      {cachedAt && (
        <p className="relative px-4 pt-2 text-right text-xs text-slate-500">
          最終更新: {new Date(cachedAt).toLocaleString("ja-JP")}
        </p>
      )}

      <main className="relative mx-auto max-w-2xl px-4 pt-3">
        {state === "loading" && (
          <p className="mt-16 text-center text-base text-slate-400">読み込み中…</p>
        )}
        {state === "not-found" && (
          <p className="mt-16 text-center text-base text-slate-400">
            このパンフレットはまだ公開されていません。
          </p>
        )}
        {state === "error" && !data && (
          <p className="mt-16 text-center text-base text-rose-400">
            読み込みに失敗しました。しばらくしてから「🔄 更新」をお試しください。
          </p>
        )}

        {data && (
          <>
            {data.bands.length > 0 && (
              <label className="mt-2 flex min-h-11 flex-col gap-1 text-sm text-slate-300">
                マイタイムテーブル（バンドで絞り込み）
                <select
                  value={myTimetableBandId}
                  onChange={(e) => setMyTimetableBandId(e.target.value)}
                  className="min-h-11 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-card-bg)] px-3 text-base text-slate-100 outline-none backdrop-blur-md focus:border-indigo-500"
                >
                  <option value="">すべて表示</option>
                  {data.bands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {data.days.map((day) => (
              <PamphletDaySection
                key={day.id}
                day={day}
                bandsById={bandsById}
                activeRow={activeRow}
                justAutoFocusedSlotId={justAutoFocusedSlotId}
                isRelevantSlot={isRelevantSlot}
                showTransitions={!myTimetableBandId}
                onSelectBand={setSelectedBand}
              />
            ))}
          </>
        )}
      </main>

      {selectedBand && (
        <BandDetailSheet band={selectedBand} onClose={() => setSelectedBand(null)} />
      )}
    </div>
  );
}

// Concert-like dynamic gradient + faint instrument silhouettes — purely
// decorative, `pointer-events-none` and `aria-hidden`, sitting behind
// every other layer (`-z-10`) so it never affects legibility or
// interaction. Uses this app's own theme CSS variables (--indigo-*)
// rather than hardcoded colors, so it automatically matches whichever of
// light/dark/system the visitor has selected (see useSyncThemeAttribute)
// with no separate light/dark branching needed here.
function PamphletBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 15% -10%, var(--indigo-950), transparent), " +
            "radial-gradient(ellipse 60% 40% at 100% 0%, var(--indigo-900), transparent)",
        }}
      />
      <div
        className="absolute inset-0 text-slate-500 opacity-[0.06]"
        style={{ backgroundImage: INSTRUMENTS_BG, backgroundRepeat: "repeat" }}
      />
    </div>
  );
}

function PamphletDaySection({
  day,
  bandsById,
  activeRow,
  justAutoFocusedSlotId,
  isRelevantSlot,
  showTransitions,
  onSelectBand,
}: {
  day: PublicDay;
  bandsById: Map<string, PublicBand>;
  activeRow: { id: string; kind: "slot" | "transition" } | null;
  justAutoFocusedSlotId: string | null;
  isRelevantSlot: (slot: PublicSlot) => boolean;
  showTransitions: boolean;
  onSelectBand: (band: PublicBand) => void;
}) {
  // buildPamphletRows interleaves a synthetic "転換中" row into any real
  // gap between two consecutive slots' recorded times (see
  // transitionGaps.ts — the admin schedule already bakes transition time
  // into that gap, nothing extra to fetch or compute server-side).
  // Filtered AFTER interleaving, not before: isRelevantSlot only ever
  // applies to real `slot` rows, and My Timetable's band filter hides
  // transition rows entirely (showTransitions=false) rather than trying
  // to decide whether a changeover "belongs" to the selected band.
  const rows = buildPamphletRows(day).filter(
    (row) => (row.kind === "slot" ? isRelevantSlot(row.slot) : showTransitions),
  );
  if (rows.length === 0) return null;

  return (
    <section className="mt-5">
      <h2 className="text-base font-semibold tracking-tight text-slate-200">
        {day.label}
        {day.date && <span className="ml-2 text-sm font-normal text-slate-500">{day.date}</span>}
      </h2>
      <ul className="mt-2 space-y-2.5">
        {rows.map((row) =>
          row.kind === "transition" ? (
            <TransitionRow
              key={row.gap.id}
              gap={row.gap}
              isActive={activeRow?.id === row.gap.id}
              isJustFocused={justAutoFocusedSlotId === row.gap.id}
            />
          ) : (
            <SlotRow
              key={row.slot.id}
              slot={row.slot}
              band={row.slot.bandId ? bandsById.get(row.slot.bandId) : undefined}
              isActive={activeRow?.id === row.slot.id}
              isJustFocused={justAutoFocusedSlotId === row.slot.id}
              onSelectBand={onSelectBand}
            />
          ),
        )}
      </ul>
    </section>
  );
}

function SlotRow({
  slot,
  band,
  isActive,
  isJustFocused,
  onSelectBand,
}: {
  slot: PublicSlot;
  band: PublicBand | undefined;
  isActive: boolean;
  isJustFocused: boolean;
  onSelectBand: (band: PublicBand) => void;
}) {
  const label = band?.name ?? slot.customLabel ?? "（未定）";
  const activeStatus = band
    ? "出演中！"
    : /リハーサル|リハ/.test(slot.customLabel ?? "")
      ? "リハーサル中！"
      : /休憩|ブレイク/.test(slot.customLabel ?? "")
        ? "休憩中！"
        : /転換/.test(slot.customLabel ?? "")
          ? "転換中！"
          : `${slot.customLabel ?? "イベント"}中！`;
  return (
    <li>
      <button
        id={`pamphlet-slot-${slot.id}`}
        type="button"
        disabled={!band}
        onClick={() => band && onSelectBand(band)}
        className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3.5 text-left backdrop-blur-md transition ${
          isActive
            ? "border-indigo-400/60 bg-indigo-500/15 ring-2 ring-indigo-400/50"
            : "border-[var(--glass-border)] bg-[var(--glass-card-bg)]"
        } ${band ? "hover:bg-[var(--glass-card-bg-hover)]" : "cursor-default"} ${
          isJustFocused ? "pamphlet-auto-focus-pulse" : ""
        }`}
      >
        <span>
          <span className="block text-base font-semibold text-slate-100">
            {isActive && <span className="mr-1.5 text-indigo-300">▶ {activeStatus}</span>}
            {label}
          </span>
          <span className="block text-sm text-slate-400">
            {slot.startTime} 〜 {slot.endTime}
          </span>
        </span>
        {band && <span className="text-sm text-indigo-300">詳細 ›</span>}
      </button>
    </li>
  );
}

// A "転換中" (mid-transition) row for the gap between two performances —
// dashed border and no click action (there's no band/detail behind it)
// deliberately distinguishes it from a real performance/custom slot at a
// glance, while still using the identical id pattern
// (`pamphlet-slot-<id>`) and highlight/pulse treatment as a real row, so
// the same auto-scroll-on-load effect in PublicPamphletRoot works on it
// with no special-casing needed there.
function TransitionRow({
  gap,
  isActive,
  isJustFocused,
}: {
  gap: { id: string; startTime: string; endTime: string };
  isActive: boolean;
  isJustFocused: boolean;
}) {
  return (
    <li>
      <div
        id={`pamphlet-slot-${gap.id}`}
        className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border border-dashed px-4 py-3 text-left backdrop-blur-md transition ${
          isActive
            ? "border-amber-400/60 bg-amber-500/15 ring-2 ring-amber-400/50"
            : "border-[var(--glass-border)] bg-transparent"
        } ${isJustFocused ? "pamphlet-auto-focus-pulse" : ""}`}
      >
        <span>
          <span className="block text-sm font-semibold text-slate-300">
            {isActive && <span className="mr-1.5 text-amber-300">▶ 転換中！</span>}
            転換
          </span>
          <span className="block text-sm text-slate-500">
            {gap.startTime} 〜 {gap.endTime}
          </span>
        </span>
      </div>
    </li>
  );
}

function BandDetailSheet({ band, onClose }: { band: PublicBand; onClose: () => void }) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--glass-border)] bg-slate-900/90 p-5 shadow-2xl backdrop-blur-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-lg font-bold tracking-tight text-slate-100">{band.name}</h2>
            <button
              type="button"
              onClick={onClose}
              title="閉じる"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl leading-none text-slate-500 hover:bg-slate-800 hover:text-slate-300"
            >
              ×
            </button>
          </div>

          <h3 className="mt-4 text-sm font-semibold text-slate-400">メンバー</h3>
          {band.memberDetails && band.memberDetails.length > 0 ? (
            <ul className="mt-1 space-y-1">
              {band.memberDetails.map((m, i) => (
                <li key={i} className="text-base text-slate-200">
                  {m.name}
                  {(m.grade || m.part) && (
                    <span className="ml-1.5 text-sm text-slate-500">
                      {[m.grade, m.part].filter(Boolean).join(" / ")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : band.members.length > 0 ? (
            <p className="mt-1 text-base text-slate-200">{band.members.join("、")}</p>
          ) : (
            <p className="mt-1 text-sm text-slate-500">メンバー情報はありません</p>
          )}

          <h3 className="mt-4 text-sm font-semibold text-slate-400">セットリスト</h3>
          {band.setlist.length > 0 ? (
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              {band.setlist.map((song, i) => (
                <li key={i} className="text-base text-slate-200">
                  {song}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-1 text-sm text-slate-500">セットリスト情報はありません</p>
          )}
        </div>
      </div>
    </div>
  );
}
