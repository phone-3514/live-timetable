import { useEffect, useMemo, useState } from "react";
import { PamphletThemeToggle } from "./PamphletThemeToggle";
import { useSyncThemeAttribute } from "../hooks/useSyncThemeAttribute";
import { usePamphletCache } from "./usePamphletCache";
import { useActiveSlotId } from "./useActiveSlotId";
import type { PublicBand, PublicDay, PublicSlot } from "./types";

interface Props {
  circleId: string;
}

// The entire public pamphlet route tree lives in this one directory
// (src/pamphlet/) and imports NOTHING from the admin editor beyond two
// deliberately Firebase-free, editing-free primitives: useThemeStore (via
// ThemeToggle) and useSyncThemeAttribute. No dnd-kit, no useAppStore, no
// CSV/Excel/PDF export code, no drag-and-drop, no room password gate —
// this route is read-only by construction, not just by omitted buttons,
// since none of the code that could mutate anything is even imported
// here. See firestore.rules for the matching server-side enforcement
// (this collection has no client write rule at all).
export function PublicPamphletRoot({ circleId }: Props) {
  useSyncThemeAttribute();
  const { data, state, cachedAt, refreshing, refresh } = usePamphletCache(circleId);
  const activeSlotId = useActiveSlotId(data);
  const [selectedBand, setSelectedBand] = useState<PublicBand | null>(null);
  const [myTimetableBandId, setMyTimetableBandId] = useState<string>("");

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

  return (
    <div className="min-h-screen bg-slate-950 pb-8 text-slate-100">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-900/80 px-4 py-3 backdrop-blur-md supports-[backdrop-filter]:bg-slate-900/70">
        <div>
          <h1 className="text-lg font-bold text-slate-100 md:text-xl">
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
            className="flex min-h-11 items-center gap-1.5 rounded-full border border-slate-600 px-3 text-sm font-medium text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {refreshing ? "更新中…" : "🔄 更新"}
          </button>
          <PamphletThemeToggle />
        </div>
      </header>

      {cachedAt && (
        <p className="px-4 pt-2 text-right text-xs text-slate-500">
          最終更新: {new Date(cachedAt).toLocaleString("ja-JP")}
        </p>
      )}

      <main className="mx-auto max-w-2xl px-4 pt-3">
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
                  className="min-h-11 rounded-lg border border-slate-600 bg-slate-900 px-3 text-base text-slate-100 outline-none focus:border-indigo-500"
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
                activeSlotId={activeSlotId}
                isRelevantSlot={isRelevantSlot}
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

function PamphletDaySection({
  day,
  bandsById,
  activeSlotId,
  isRelevantSlot,
  onSelectBand,
}: {
  day: PublicDay;
  bandsById: Map<string, PublicBand>;
  activeSlotId: string | null;
  isRelevantSlot: (slot: PublicSlot) => boolean;
  onSelectBand: (band: PublicBand) => void;
}) {
  const visibleSlots = day.slots.filter(isRelevantSlot);
  if (visibleSlots.length === 0) return null;

  return (
    <section className="mt-5">
      <h2 className="text-base font-semibold text-slate-200">
        {day.label}
        {day.date && <span className="ml-2 text-sm font-normal text-slate-500">{day.date}</span>}
      </h2>
      <ul className="mt-2 space-y-2">
        {visibleSlots.map((slot) => {
          const band = slot.bandId ? bandsById.get(slot.bandId) : undefined;
          const isActive = slot.id === activeSlotId;
          const label = band?.name ?? slot.customLabel ?? "（未定）";
          return (
            <li key={slot.id}>
              <button
                type="button"
                disabled={!band}
                onClick={() => band && onSelectBand(band)}
                className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition ${
                  isActive
                    ? "border-indigo-500 bg-indigo-950/50 ring-2 ring-indigo-500/60"
                    : "border-slate-700 bg-slate-900"
                } ${band ? "hover:bg-slate-800" : "cursor-default"}`}
              >
                <span>
                  <span className="block text-base font-semibold text-slate-100">
                    {isActive && <span className="mr-1.5 text-indigo-300">▶ 出演中</span>}
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
        })}
      </ul>
    </section>
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
          className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-lg font-bold text-slate-100">{band.name}</h2>
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
