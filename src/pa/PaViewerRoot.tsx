import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import type { Band, TimetableDay, TimetableSlot } from "../types";
import type { StagePhase, StageProgress } from "../store/useProgressStore";
import { normalizeBandName, type PaDriveFolder, type PaLinkConfig, type PaSheetLink } from "./types";

type PaRoomDoc = {
  liveName?: string;
  bands?: Band[];
  days?: TimetableDay[];
  progress?: StageProgress;
  paConfig?: PaLinkConfig;
};

type SyncState = "connecting" | "synced" | "offline" | "not-found" | "error";
type ScheduledBand = {
  band: Band;
  day: TimetableDay;
  slot: TimetableSlot;
  order: number;
};

const PA_ROOM_KEY = "live-timetable-pa-room";

function normalizeRoomCode(value: string) {
  const normalized = value.trim().replace(/[\s-]+/g, "").toLowerCase();
  return /^[a-z0-9]{8}$/.test(normalized) ? normalized : null;
}

function initialRoomId() {
  const fromUrl = normalizeRoomCode(new URLSearchParams(window.location.search).get("room") ?? "");
  if (fromUrl) return fromUrl;
  try {
    return normalizeRoomCode(localStorage.getItem(PA_ROOM_KEY) ?? "");
  } catch {
    return null;
  }
}

function phaseLabel(phase: StagePhase | undefined) {
  if (phase === "performing") return "出演中";
  if (phase === "transition") return "転換中";
  if (phase === "break") return "休憩・イベント中";
  if (phase === "finished") return "終演";
  return "待機中";
}

function dateAtTime(day: TimetableDay, hhmm: string) {
  const [hours, minutes] = hhmm.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const base = day.date ? new Date(`${day.date}T00:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) return null;
  base.setHours(hours, minutes, 0, 0);
  return base;
}

function formatCountdown(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function useOnlineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

function RoomEntry({ onJoin }: { onJoin: (roomId: string) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const roomId = normalizeRoomCode(code);
    if (!roomId) {
      setError(true);
      return;
    }
    onJoin(roomId);
  };
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#020617] p-5 text-slate-100">
      <section className="w-full max-w-sm rounded-3xl border border-slate-700 bg-slate-900/90 p-6 shadow-2xl shadow-black/40">
        <p className="text-xs font-bold tracking-[0.18em] text-blue-300">PA / ROADIE SYNC</p>
        <h1 className="mt-2 text-2xl font-black tracking-tight">PAシートを開く</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">イベントの8文字の共有コードを入力してください。</p>
        <p className="mt-2 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs leading-5 text-slate-400">この画面をホーム画面へ追加すると、PA専用アプリとして次回も同じイベントを開けます。</p>
        <form className="mt-5" onSubmit={submit}>
          <label className="text-sm font-semibold text-slate-300" htmlFor="pa-room-code">共有コード</label>
          <input
            id="pa-room-code"
            value={code}
            onChange={(event) => { setCode(event.target.value.toUpperCase()); setError(false); }}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={11}
            placeholder="ABCD2345"
            className="mt-2 min-h-14 w-full rounded-xl border border-slate-600 bg-slate-950 px-4 text-center font-mono text-xl font-bold tracking-[0.18em] text-white outline-none placeholder:text-slate-600 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20"
          />
          {error && <p className="mt-2 text-sm font-semibold text-rose-300" role="alert">8文字の共有コードを確認してください</p>}
          <button type="submit" className="mt-4 min-h-14 w-full rounded-xl bg-blue-600 px-4 text-base font-black text-white shadow-lg shadow-blue-950/50 hover:bg-blue-500 active:bg-blue-700">接続する</button>
        </form>
      </section>
    </main>
  );
}

function SheetLinkViewer({ matchedLinks, folders, bandName }: {
  matchedLinks: PaSheetLink[];
  folders: PaDriveFolder[];
  bandName: string;
}) {
  const links = matchedLinks.length > 0
    ? matchedLinks.map((link, index) => ({
        label: link.label || link.fileName || `PAシート${index + 1}`,
        detail: link.fileName,
        url: link.url,
      }))
    : folders.map((folder, index) => ({
        label: folder.label.trim() || `PAフォルダ${index + 1}`,
        detail: "一致ファイルなし・フォルダを開く",
        url: folder.url,
      }));
  if (links.length === 0) return <div className="grid h-full place-items-center px-6 text-center"><div className="max-w-sm"><p className="text-5xl" aria-hidden="true">📄</p><h2 className="mt-3 text-2xl font-black">シート未登録</h2><p className="mt-2 text-sm leading-6 text-slate-400"><strong className="text-slate-200">{bandName}</strong> のPA／ステージ資料はまだ登録されていません。</p></div></div>;
  return (
    <div className="h-full overflow-y-auto px-4 py-5 sm:px-6">
      <section className="mx-auto w-full max-w-2xl rounded-3xl border border-blue-800/70 bg-gradient-to-b from-blue-950/60 to-slate-900 p-5 shadow-2xl sm:p-7">
        <p className="text-xs font-bold tracking-[0.16em] text-blue-300">PA / STAGE DOCUMENTS</p>
        <div className="mt-2 flex items-end justify-between gap-3">
          <h2 className="min-w-0 truncate text-2xl font-black text-white">{bandName}</h2>
          <span className="shrink-0 rounded-full bg-blue-500/15 px-2.5 py-1 text-xs font-black text-blue-200">{links.length}件</span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {links.map((link, index) => (
            <a
              key={`${link.url}-${index}`}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-blue-500/40 bg-blue-600 px-5 text-left text-base font-black text-white shadow-lg shadow-blue-950/60 transition-colors hover:bg-blue-500 active:bg-blue-700"
            >
              <span className="min-w-0"><span className="block break-words">{link.label}</span>{link.detail && link.detail !== link.label && <span className="mt-1 block truncate text-xs font-semibold text-blue-100/70">{link.detail}</span>}</span>
              <span className="shrink-0 text-xl" aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-400">リンクは別タブで開きます。Google Driveアプリがある端末では、そのまま資料を表示できます。</p>
      </section>
    </div>
  );
}

export function PaViewerRoot() {
  const [roomId, setRoomId] = useState<string | null>(initialRoomId);
  const [room, setRoom] = useState<PaRoomDoc | null>(null);
  const [publicProgress, setPublicProgress] = useState<StageProgress | null>(null);
  const [syncState, setSyncState] = useState<SyncState>(roomId ? "connecting" : "offline");
  const [manualSlotId, setManualSlotId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const online = useOnlineStatus();

  useEffect(() => {
    if (!roomId) return;
    try { localStorage.setItem(PA_ROOM_KEY, roomId); } catch { /* continue without remembered event */ }
  }, [roomId]);

  useEffect(() => {
    document.title = room?.liveName ? `PAシート — ${room.liveName}` : "PA / Roadie Sync";
  }, [room?.liveName]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!roomId || !db) {
      if (roomId) setSyncState("error");
      return;
    }
    setSyncState("connecting");
    setRoom(null);
    setPublicProgress(null);
    const unsubscribeRoom = onSnapshot(doc(db, "rooms", roomId), { includeMetadataChanges: true }, (snapshot) => {
      if (!snapshot.exists()) {
        if (!snapshot.metadata.fromCache) setSyncState("not-found");
        return;
      }
      setRoom(snapshot.data() as PaRoomDoc);
      setSyncState(snapshot.metadata.fromCache ? (navigator.onLine ? "connecting" : "offline") : "synced");
    }, () => setSyncState("error"));
    const unsubscribeProgress = onSnapshot(doc(db, "publicProgress", roomId), (snapshot) => {
      setPublicProgress(snapshot.exists() ? snapshot.data() as StageProgress : null);
    }, () => undefined);
    return () => { unsubscribeRoom(); unsubscribeProgress(); };
  }, [roomId]);

  useEffect(() => {
    if (!online && roomId) setSyncState("offline");
  }, [online, roomId]);

  const progress = useMemo(() => {
    const local = room?.progress ?? null;
    if (!publicProgress) return local;
    if (!local) return publicProgress;
    return publicProgress.updatedAt >= local.updatedAt ? publicProgress : local;
  }, [publicProgress, room?.progress]);

  const scheduled = useMemo(() => {
    const bands = new Map((room?.bands ?? []).map((band) => [band.id, band]));
    const result: ScheduledBand[] = [];
    const seenBands = new Set<string>();
    let order = 0;
    for (const day of room?.days ?? []) {
      for (const slot of day.slots ?? []) {
        const band = slot.bandId ? bands.get(slot.bandId) : null;
        if (band) {
          // A Band is meant to occupy one slot, but older rooms and a
          // simultaneous collaborative move can temporarily leave the
          // same band in multiple slots. Those duplicate slots must not
          // become duplicate "Next sheet" stops in the PA remote.
          const identity = normalizeBandName(band.name) || band.id;
          if (!seenBands.has(identity)) {
            seenBands.add(identity);
            result.push({ band, day, slot, order });
          }
        }
        order += 1;
      }
    }
    return result;
  }, [room?.bands, room?.days]);

  const activeSlotOrder = useMemo(() => {
    let order = 0;
    for (const day of room?.days ?? []) {
      for (const slot of day.slots ?? []) {
        if (slot.id === progress?.slotId) return order;
        order += 1;
      }
    }
    return -1;
  }, [progress?.slotId, room?.days]);

  const liveIndex = useMemo(() => {
    const exact = scheduled.findIndex((item) => item.slot.id === progress?.slotId);
    if (exact >= 0) return exact;
    // If progress points at a duplicate slot removed above, keep showing
    // that band's single canonical sheet instead of treating it as a
    // non-band row and jumping to the following band.
    const progressSlot = (room?.days ?? [])
      .flatMap((day) => day.slots)
      .find((slot) => slot.id === progress?.slotId);
    const progressBand = progressSlot?.bandId
      ? (room?.bands ?? []).find((band) => band.id === progressSlot.bandId)
      : null;
    if (progressBand) {
      const identity = normalizeBandName(progressBand.name) || progressBand.id;
      const sameBandIndex = scheduled.findIndex(
        (item) => (normalizeBandName(item.band.name) || item.band.id) === identity,
      );
      if (sameBandIndex >= 0) return sameBandIndex;
    }
    if (activeSlotOrder >= 0) {
      const nextIndex = scheduled.findIndex((item) => item.order > activeSlotOrder);
      if (nextIndex >= 0) return nextIndex;
    }
    const activeByClock = scheduled.findIndex((item) => {
      const start = dateAtTime(item.day, item.slot.startTime)?.getTime();
      const end = dateAtTime(item.day, item.slot.endTime)?.getTime();
      return start !== undefined && start !== null && end !== undefined && end !== null && now >= start && now < end;
    });
    return activeByClock >= 0 ? activeByClock : 0;
  }, [activeSlotOrder, now, progress?.slotId, room?.bands, room?.days, scheduled]);

  const activeSlot = useMemo(() => {
    for (const day of room?.days ?? []) {
      const slot = day.slots.find((candidate) => candidate.id === progress?.slotId);
      if (slot) return slot;
    }
    return null;
  }, [progress?.slotId, room?.days]);

  const manualIndex = manualSlotId ? scheduled.findIndex((item) => item.slot.id === manualSlotId) : -1;
  const selectedIndex = manualIndex >= 0 ? manualIndex : liveIndex;
  const selected = scheduled[selectedIndex] ?? null;
  const live = scheduled[liveIndex] ?? null;
  const nextLive = scheduled[liveIndex + 1] ?? null;
  const activeBand = activeSlot?.bandId
    ? (room?.bands ?? []).find((band) => band.id === activeSlot.bandId)
    : null;
  const activeDay = activeSlot
    ? (room?.days ?? []).find((day) => day.slots.some((slot) => slot.id === activeSlot.id))
    : null;
  const liveIsActiveSlot = live?.slot.id === activeSlot?.id
    || Boolean(activeBand && live
      && (normalizeBandName(activeBand.name) || activeBand.id)
        === (normalizeBandName(live.band.name) || live.band.id));
  const currentHeaderName = activeSlot
    ? (liveIsActiveSlot ? live.band.name : activeSlot.customLabel || "バンド出演なし")
    : live?.band.name ?? "—";
  const nextHeaderEntry = liveIsActiveSlot ? nextLive : live;
  const matchingLinks = selected
    ? (room?.paConfig?.links ?? []).filter((link) =>
        link.bandId === selected.band.id
        || normalizeBandName(link.bandName) === normalizeBandName(selected.band.name),
      )
    : [];
  const configuredFolders = room?.paConfig?.folders?.length
    ? room.paConfig.folders
    : room?.paConfig?.folderUrl
      ? [{ label: "PAフォルダ", url: room.paConfig.folderUrl }]
      : [];

  const countdownTarget = progress?.phase === "performing" && liveIsActiveSlot && activeSlot && activeDay
    ? dateAtTime(activeDay, activeSlot.endTime)
    : nextHeaderEntry ? dateAtTime(nextHeaderEntry.day, nextHeaderEntry.slot.startTime) : null;
  const countdownLabel = progress?.phase === "performing" ? "終了まで" : "次の開始まで";

  const join = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("room", id);
    window.history.replaceState(null, "", url.toString());
    try { localStorage.setItem(PA_ROOM_KEY, id); } catch { /* continue without remembered event */ }
    setRoomId(id);
  };
  const leave = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("room");
    window.history.replaceState(null, "", url.toString());
    try { localStorage.removeItem(PA_ROOM_KEY); } catch { /* no persistent storage available */ }
    setRoomId(null);
    setRoom(null);
    setManualSlotId(null);
  };

  if (!roomId) return <RoomEntry onJoin={join} />;
  if (syncState === "not-found") return <main className="grid min-h-dvh place-items-center bg-[#020617] p-6 text-center text-white"><div><p className="text-5xl">🔎</p><h1 className="mt-4 text-2xl font-black">イベントが見つかりません</h1><p className="mt-2 text-sm text-slate-400">共有コードを確認してください。</p><button type="button" onClick={leave} className="mt-5 min-h-12 rounded-xl bg-blue-600 px-5 font-bold hover:bg-blue-500">コードを入力し直す</button></div></main>;

  const syncLabel = !online || syncState === "offline" ? "オフライン" : syncState === "synced" ? "リアルタイム" : syncState === "error" ? "同期エラー" : "同期中…";
  const syncColor = syncLabel === "リアルタイム" ? "bg-emerald-400" : syncLabel === "同期中…" ? "bg-amber-400" : "bg-rose-400";

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#020617] text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-700 bg-slate-900/95 px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] shadow-xl backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="min-w-0"><p className="truncate text-xs font-bold tracking-[0.12em] text-blue-300">{room?.liveName || "PA / ROADIE SYNC"}</p><p className="mt-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-slate-400"><span className={`h-2 w-2 rounded-full ${syncColor}`} />{syncLabel}</p></div>
          <button type="button" onClick={leave} className="min-h-10 shrink-0 rounded-lg border border-slate-600 px-3 text-xs font-bold text-slate-300 hover:bg-slate-800">イベント変更</button>
        </div>
        <div className="mx-auto mt-3 grid max-w-5xl grid-cols-[1fr_1fr_auto] gap-2">
          <section className="min-w-0 rounded-xl border border-blue-800/70 bg-blue-950/60 px-3 py-2"><p className="text-[10px] font-bold tracking-wider text-blue-300">CURRENT · {phaseLabel(progress?.phase)}</p><p className="mt-0.5 truncate text-sm font-black text-white">{currentHeaderName}</p></section>
          <section className="min-w-0 rounded-xl border border-slate-700 bg-slate-800/70 px-3 py-2"><p className="text-[10px] font-bold tracking-wider text-slate-400">NEXT</p><p className="mt-0.5 truncate text-sm font-black text-slate-100">{nextHeaderEntry?.band.name ?? "—"}</p></section>
          <section className="min-w-[5.25rem] rounded-xl border border-slate-700 bg-slate-950 px-2 py-2 text-right"><p className="text-[9px] font-bold text-slate-500">{countdownLabel}</p><time className="font-mono text-base font-black tabular-nums text-blue-300">{countdownTarget ? formatCountdown(countdownTarget.getTime() - now) : "--:--"}</time></section>
        </div>
        {manualSlotId && <div className="mx-auto mt-2 flex max-w-5xl items-center justify-between gap-3 rounded-lg border border-amber-700/80 bg-amber-950/50 px-3 py-2"><p className="truncate text-xs font-bold text-amber-200">手動表示中 · 自動切替を停止</p><button type="button" onClick={() => setManualSlotId(null)} className="min-h-9 shrink-0 rounded-lg bg-amber-500 px-3 text-xs font-black text-slate-950 hover:bg-amber-400">ライブ同期へ戻る</button></div>}
      </header>

      <main className="min-h-0 flex-1 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
        {syncState === "connecting" && !room ? <div className="grid h-full min-h-[55vh] place-items-center text-slate-400">リアルタイム情報に接続中…</div>
          : syncState === "error" && !room ? <div className="grid h-full min-h-[55vh] place-items-center px-6 text-center"><div><p className="text-xl font-black">同期に接続できません</p><p className="mt-2 text-sm text-slate-400">通信状態とFirebase設定を確認してください。</p></div></div>
          : !selected ? <div className="grid h-full min-h-[55vh] place-items-center px-6 text-center"><div><p className="text-4xl">🎚️</p><h2 className="mt-3 text-xl font-black">出演バンドが未登録です</h2><p className="mt-2 text-sm text-slate-400">タイムテーブルにバンドを配置するとシートが表示されます。</p></div></div>
          : <div className="h-full min-h-0"><div className="flex h-10 items-center justify-between border-b border-slate-800 bg-slate-900 px-3"><p className="truncate text-sm font-bold"><span className="mr-2 text-xs text-slate-500">表示中</span>{selected.band.name}</p><span className="shrink-0 text-[10px] font-semibold text-slate-500">Driveリンク</span></div><div className="h-[calc(100%-2.5rem)]"><SheetLinkViewer matchedLinks={matchingLinks} folders={configuredFolders} bandName={selected.band.name} /></div></div>}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-700 bg-slate-900/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl" aria-label="PAシート手動切り替え">
        <div className="mx-auto grid max-w-2xl grid-cols-2 gap-3">
          <button type="button" disabled={selectedIndex <= 0} onClick={() => setManualSlotId(scheduled[selectedIndex - 1]?.slot.id ?? null)} className="min-h-14 rounded-xl border border-slate-600 bg-slate-800 px-4 text-left font-black text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-35"><span className="mr-2 text-blue-300">‹</span>前のシート</button>
          <button type="button" disabled={selectedIndex < 0 || selectedIndex >= scheduled.length - 1} onClick={() => setManualSlotId(scheduled[selectedIndex + 1]?.slot.id ?? null)} className="min-h-14 rounded-xl bg-blue-600 px-4 text-right font-black text-white shadow-lg shadow-blue-950/60 hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-35">次のシート<span className="ml-2">›</span></button>
        </div>
      </nav>
    </div>
  );
}
