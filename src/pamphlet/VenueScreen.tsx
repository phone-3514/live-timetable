import { useEffect, useMemo, useState } from "react";
import type { StageProgress } from "../store/useProgressStore";
import type { PublicPamphletDoc } from "./types";
import { QrCode } from "../components/QrCode";

export function VenueScreen({ data, progress, circleId, onExit }: { data: PublicPamphletDoc; progress: StageProgress | null; circleId: string; onExit: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const rows = useMemo(() => data.days.flatMap((day) => day.slots.map((slot) => ({ day, slot }))), [data]);
  let index = progress?.slotId ? rows.findIndex((row) => row.slot.id === progress.slotId) : -1;
  if (index < 0) {
    const currentMinutes = new Date(now).getHours() * 60 + new Date(now).getMinutes();
    index = rows.findIndex(({ slot }) => { const [sh, sm] = slot.startTime.split(":").map(Number); const [eh, em] = slot.endTime.split(":").map(Number); return currentMinutes >= sh * 60 + sm && currentMinutes < eh * 60 + em; });
  }
  const current = rows[index];
  const next = rows[index + 1];
  const bandMap = new Map(data.bands.map((band) => [band.id, band]));
  const label = (row: typeof current) => row ? (row.slot.bandId ? bandMap.get(row.slot.bandId)?.name : row.slot.customLabel) || "未定" : "—";
  const phase = progress?.phase ?? "standby";
  const first = rows[0]?.slot;
  const start = first ? new Date(`${rows[0].day.date ?? new Date().toISOString().slice(0, 10)}T${first.startTime}:00`).getTime() : now;
  const countdown = Math.max(0, start - now);
  const countdownText = `${String(Math.floor(countdown / 3600000)).padStart(2, "0")}:${String(Math.floor((countdown % 3600000) / 60000)).padStart(2, "0")}:${String(Math.floor((countdown % 60000) / 1000)).padStart(2, "0")}`;
  const publicUrl = `${window.location.origin}${import.meta.env.BASE_URL}${circleId}/public`;
  return <main className="relative flex h-[calc(100dvh-env(safe-area-inset-top))] max-h-[calc(100dvh-env(safe-area-inset-top))] flex-col overflow-hidden bg-[#020617] p-[4vw] text-white md:h-auto md:max-h-none md:min-h-screen md:overflow-visible" aria-live="polite"><button type="button" onClick={onExit} className="fixed left-3 top-3 z-20 min-h-11 rounded-xl border border-slate-600 bg-slate-900/90 px-4 text-sm font-bold text-white shadow-lg backdrop-blur hover:bg-slate-800">← 通常表示へ戻る</button><header className="flex shrink-0 items-start justify-between pt-12"><div><p className="text-[clamp(1rem,2vw,2rem)] font-semibold tracking-[0.2em] text-blue-300">LIVE TIMETABLE</p><h1 className="mt-2 text-[clamp(2rem,5vw,5rem)] font-black leading-none">{data.liveName || "Stage"}</h1></div><div className="rounded-2xl bg-white p-2"><QrCode value={publicUrl} label="観客向けパンフレット" size={140} /></div></header><section className="flex min-h-0 flex-1 flex-col justify-center overflow-hidden"><p className="text-[clamp(1.3rem,3vw,3rem)] font-bold text-blue-300">{phase === "transition" ? "転換中" : phase === "break" ? "休憩中" : phase === "finished" ? "本日の公演は終了しました" : current ? "現在出演中" : `開演まで ${countdownText}`}</p><h2 className="mt-4 truncate text-[clamp(3rem,10vw,10rem)] font-black leading-[0.95] tracking-tight">{phase === "transition" ? "STAGE CHANGE" : label(current)}</h2>{current && <p className="mt-5 font-mono text-[clamp(1.5rem,4vw,4rem)] text-slate-300">{current.slot.startTime} — {current.slot.endTime}</p>}</section><footer className="grid shrink-0 grid-cols-[auto_1fr] items-center gap-6 border-t border-slate-700 pt-5"><span className="text-[clamp(1rem,2vw,2rem)] font-bold text-slate-400">NEXT</span><strong className="truncate text-[clamp(2rem,5vw,5rem)]">{label(next)}</strong></footer></main>;
}
