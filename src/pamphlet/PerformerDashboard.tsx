import { useEffect, useMemo, useState } from "react";
import type { StageProgress } from "../store/useProgressStore";
import type { PublicBand, PublicPamphletDoc, PublicSlot } from "./types";

function subtractMinutes(time: string, minutes: number) {
  const [hours, mins] = time.split(":").map(Number);
  const total = (hours * 60 + mins - minutes + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function PerformerDashboard({ data, performerName, bands, progress }: {
  data: PublicPamphletDoc;
  performerName: string;
  bands: PublicBand[];
  progress: StageProgress | null;
}) {
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof Notification === "undefined" ? "denied" : Notification.permission,
  );
  const [notificationUnavailable, setNotificationUnavailable] = useState(false);
  const bandIds = useMemo(() => new Set(bands.map((band) => band.id)), [bands]);
  const bandNames = useMemo(() => bands.map((band) => band.name), [bands]);
  const bandMap = useMemo(() => new Map(data.bands.map((band) => [band.id, band.name])), [data.bands]);
  const rows = useMemo(
    () => data.days.flatMap((day) => day.slots.map((slot, index) => ({ day, slot, index }))),
    [data.days],
  );
  const performances = useMemo(
    () => rows.filter(({ slot }) => Boolean(slot.bandId && bandIds.has(slot.bandId))),
    [rows, bandIds],
  );
  const rehearsals = useMemo(
    () => rows.filter(({ slot }) =>
      /リハーサル|リハ/.test(slot.customLabel ?? "") && bandNames.some((name) => slot.customLabel?.includes(name)),
    ),
    [rows, bandNames],
  );
  const currentIndex = progress?.slotId ? rows.findIndex(({ slot }) => slot.id === progress.slotId) : -1;
  const activeSlot = rows[currentIndex]?.slot;
  const nextSlot = rows[currentIndex + 1]?.slot;
  const isMyPerformance = Boolean(activeSlot?.bandId && bandIds.has(activeSlot.bandId));
  const isMyRehearsal = Boolean(
    /リハーサル|リハ/.test(activeSlot?.customLabel ?? "") && bandNames.some((name) => activeSlot?.customLabel?.includes(name)),
  );
  const amNext = Boolean(nextSlot?.bandId && bandIds.has(nextSlot.bandId));
  const liveMessage = isMyRehearsal
    ? "あなたのリハーサル開始です"
    : isMyPerformance
      ? "あなたの出演中です"
      : progress?.phase === "transition" && amNext
        ? "転換中です。次の出演に備えて待機してください"
        : amNext
          ? "次の出演です。待機してください"
          : Math.abs(activeSlot?.delayMinutes ?? 0) >= 10
            ? (activeSlot?.delayMinutes ?? 0) > 0
              ? `進行が${activeSlot?.delayMinutes}分遅れています`
              : `進行が予定より${Math.abs(activeSlot?.delayMinutes ?? 0)}分早まっています`
            : null;

  useEffect(() => {
    if (permission !== "granted" || !progress?.updatedAt || !liveMessage) return;
    const key = `live-timetable-notified-${performerName}-${progress.updatedAt}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    new Notification(data.liveName || "Live Timetable", {
      body: liveMessage,
      icon: `${import.meta.env.BASE_URL}app-icon-192.png`,
    });
  }, [permission, progress?.updatedAt, liveMessage, performerName, data.liveName]);

  useEffect(() => {
    if (permission !== "granted" || performances.length === 0) return;
    const check = () => {
      for (const performance of performances) {
        if (!performance.day.date) continue;
        const start = new Date(`${performance.day.date}T${performance.slot.startTime}:00`).getTime();
        const remaining = start - Date.now();
        if (remaining > 30 * 60_000 || remaining <= 29 * 60_000) continue;
        const key = `live-timetable-30min-${performerName}-${performance.slot.id}-${performance.day.date}`;
        if (localStorage.getItem(key)) continue;
        localStorage.setItem(key, "1");
        const bandName = performance.slot.bandId ? bandMap.get(performance.slot.bandId) : "出演";
        new Notification(data.liveName || "Live Timetable", {
          body: `${bandName}の出演30分前です`,
          icon: `${import.meta.env.BASE_URL}app-icon-192.png`,
        });
      }
    };
    check();
    const timer = window.setInterval(check, 30_000);
    return () => clearInterval(timer);
  }, [permission, performances, performerName, bandMap, data.liveName]);

  const slotName = (slot: PublicSlot | undefined) =>
    slot ? (slot.bandId ? bandMap.get(slot.bandId) : slot.customLabel) || "未定" : "なし";

  async function enableNotifications() {
    if (typeof Notification === "undefined") {
      setNotificationUnavailable(true);
      return;
    }
    setPermission(await Notification.requestPermission());
  }

  return (
    <section className="mt-4 rounded-2xl border border-blue-500/50 bg-blue-950/25 p-4" aria-labelledby="performer-dashboard-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-blue-300">出演者マイページ</p>
          <h2 id="performer-dashboard-title" className="text-xl font-bold text-slate-100">{performerName}</h2>
        </div>
        {permission !== "granted" ? (
          <button type="button" onClick={() => void enableNotifications()} className="min-h-11 rounded-lg border border-blue-500 px-3 text-sm font-semibold text-blue-200 hover:bg-blue-900/50">
            🔔 通知を有効にする
          </button>
        ) : <span className="rounded-lg border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-300">🔔 通知有効</span>}
      </div>
      {notificationUnavailable && <p className="mt-2 text-xs text-amber-300">このブラウザでは通知を利用できません。対応ブラウザまたはホーム画面に追加したアプリからお試しください。</p>}
      {liveMessage && <p className="mt-3 rounded-lg border border-amber-500 bg-amber-950/40 p-3 text-sm font-bold text-amber-200" role="status">⚠ {liveMessage}</p>}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Info label="出演するバンド" value={bandNames.join("、")} />
        <Info label="リハーサル" value={rehearsals.length ? rehearsals.map(({ day, slot }) => `${day.label} ${slot.startTime}〜${slot.endTime}`).join("、") : "登録なし"} />
      </div>

      <div className="mt-3 space-y-3">
        {performances.map(({ day, slot, index }) => (
          <article key={slot.id} className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-bold text-slate-100">{slot.bandId ? bandMap.get(slot.bandId) : "出演"}</h3>
              <span className="font-mono text-sm font-semibold text-blue-300">{slot.startTime}〜{slot.endTime}</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">{day.label}{day.date ? `・${day.date}` : ""} ／ 集合 {subtractMinutes(slot.startTime, 30)}（目安）</p>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <Info label="直前の予定" value={slotName(day.slots[index - 1])} compact />
              <Info label="直後の予定" value={slotName(day.slots[index + 1])} compact />
            </dl>
          </article>
        ))}
        {performances.length === 0 && <p className="rounded-lg border border-slate-700 p-3 text-sm text-slate-400">出演時間は未定です。</p>}
      </div>

      <div className="mt-3 rounded-lg border border-slate-700 p-3">
        <h3 className="text-xs font-semibold text-slate-400">注意事項</h3>
        <p className="mt-1 text-sm text-slate-300">進行状況は随時更新されます。出演30分前を目安に集合し、運営からの待機案内を優先してください。</p>
      </div>
    </section>
  );
}

function Info({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return <div className={compact ? "" : "rounded-lg border border-slate-700 bg-slate-900/50 p-3"}><dt className="text-xs font-semibold text-slate-500">{label}</dt><dd className={`${compact ? "text-xs" : "text-base"} mt-1 font-semibold text-slate-100`}>{value}</dd></div>;
}
