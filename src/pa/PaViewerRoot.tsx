import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { getDownloadURL, listAll, ref } from "firebase/storage";
import { db, storage } from "../firebase";
import type { Band, TimetableDay, TimetableSlot } from "../types";
import type { StagePhase, StageProgress } from "../store/useProgressStore";

type PaRoomDoc = {
  liveName?: string;
  bands?: Band[];
  days?: TimetableDay[];
  progress?: StageProgress;
};

type SyncState = "connecting" | "synced" | "offline" | "not-found" | "error";
type SheetState = "idle" | "loading" | "ready" | "error";
type PaSheet = { name: string; url: string; kind: "pdf" | "image" };
type ScheduledBand = {
  band: Band;
  day: TimetableDay;
  slot: TimetableSlot;
  order: number;
};

const SUPPORTED_SHEET = /\.(pdf|png|jpe?g|webp|gif)$/i;

function normalizeRoomCode(value: string) {
  const normalized = value.trim().replace(/[\s-]+/g, "").toLowerCase();
  return /^[a-z0-9]{8}$/.test(normalized) ? normalized : null;
}

function initialRoomId() {
  return normalizeRoomCode(new URLSearchParams(window.location.search).get("room") ?? "");
}

function normalizeSheetName(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(SUPPORTED_SHEET, "")
    .replace(/[\s._\-‐‑–—・･()[\]（）【】『』「」]+/g, "");
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

function SheetViewer({ sheet, sheetState, bandName, roomId, onRetry }: {
  sheet: PaSheet | null;
  sheetState: SheetState;
  bandName: string;
  roomId: string;
  onRetry: () => void;
}) {
  if (sheetState === "loading" || sheetState === "idle") {
    return <div className="grid h-full place-items-center text-center"><div><span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-blue-400" /><p className="mt-3 text-sm font-semibold text-slate-400">シートを確認中…</p></div></div>;
  }
  if (sheetState === "error") {
    return <div className="grid h-full place-items-center px-6 text-center"><div><p className="text-4xl" aria-hidden="true">⚠️</p><h2 className="mt-3 text-xl font-black">シートの取得に失敗しました</h2><p className="mt-2 text-sm text-slate-400">通信状態またはFirebase Storageの設定を確認してください。</p><button type="button" onClick={onRetry} className="mt-5 min-h-12 rounded-xl border border-blue-500 px-5 font-bold text-blue-200 hover:bg-blue-950">再読み込み</button></div></div>;
  }
  if (!sheet) {
    return <div className="grid h-full place-items-center px-6 text-center"><div className="max-w-sm"><p className="text-5xl" aria-hidden="true">📄</p><h2 className="mt-3 text-2xl font-black">シート未登録</h2><p className="mt-2 text-sm leading-6 text-slate-400"><strong className="text-slate-200">{bandName}</strong> と一致するPDF・画像がありません。</p><p className="mt-4 rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-left font-mono text-xs text-slate-400">pa-sheets/{roomId}/<br /><span className="text-blue-300">{bandName}.pdf</span></p><button type="button" onClick={onRetry} className="mt-5 min-h-12 rounded-xl border border-slate-600 px-5 font-bold text-slate-200 hover:bg-slate-800">再読み込み</button></div></div>;
  }
  if (sheet.kind === "pdf") {
    return <div className="relative h-full w-full bg-slate-800"><iframe title={`${bandName} PAシート`} src={`${sheet.url}#view=FitH`} className="h-full w-full border-0 bg-white" /><a href={sheet.url} target="_blank" rel="noreferrer" className="absolute right-3 top-3 rounded-full border border-slate-500 bg-slate-950/90 px-3 py-2 text-xs font-bold text-white shadow-lg hover:bg-slate-800">別画面で開く ↗</a></div>;
  }
  return <div className="h-full w-full overflow-auto bg-slate-950 text-center" style={{ touchAction: "pan-x pan-y pinch-zoom" }}><img src={sheet.url} alt={`${bandName} PAシート`} className="inline-block min-h-full min-w-full max-w-none object-contain align-top" draggable={false} /></div>;
}

export function PaViewerRoot() {
  const [roomId, setRoomId] = useState<string | null>(initialRoomId);
  const [room, setRoom] = useState<PaRoomDoc | null>(null);
  const [publicProgress, setPublicProgress] = useState<StageProgress | null>(null);
  const [syncState, setSyncState] = useState<SyncState>(roomId ? "connecting" : "offline");
  const [sheets, setSheets] = useState<PaSheet[]>([]);
  const [sheetState, setSheetState] = useState<SheetState>("idle");
  const [sheetRefresh, setSheetRefresh] = useState(0);
  const [manualSlotId, setManualSlotId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const online = useOnlineStatus();

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

  useEffect(() => {
    if (!roomId) return;
    if (!storage) {
      setSheetState("error");
      return;
    }
    let cancelled = false;
    setSheetState("loading");
    listAll(ref(storage, `pa-sheets/${roomId}`))
      .then(async (result) => {
        const supported = result.items.filter((item) => SUPPORTED_SHEET.test(item.name));
        const resolved = await Promise.all(supported.map(async (item): Promise<PaSheet> => ({
          name: item.name,
          url: await getDownloadURL(item),
          kind: item.name.toLowerCase().endsWith(".pdf") ? "pdf" : "image",
        })));
        if (!cancelled) {
          setSheets(resolved);
          setSheetState("ready");
        }
      })
      .catch(() => { if (!cancelled) setSheetState("error"); });
    return () => { cancelled = true; };
  }, [roomId, sheetRefresh]);

  const progress = useMemo(() => {
    const local = room?.progress ?? null;
    if (!publicProgress) return local;
    if (!local) return publicProgress;
    return publicProgress.updatedAt >= local.updatedAt ? publicProgress : local;
  }, [publicProgress, room?.progress]);

  const scheduled = useMemo(() => {
    const bands = new Map((room?.bands ?? []).map((band) => [band.id, band]));
    const result: ScheduledBand[] = [];
    let order = 0;
    for (const day of room?.days ?? []) {
      for (const slot of day.slots ?? []) {
        const band = slot.bandId ? bands.get(slot.bandId) : null;
        if (band) result.push({ band, day, slot, order });
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
  }, [activeSlotOrder, now, progress?.slotId, scheduled]);

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
  const liveIsActiveSlot = live?.slot.id === activeSlot?.id;
  const currentHeaderName = activeSlot
    ? (liveIsActiveSlot ? live.band.name : activeSlot.customLabel || "バンド出演なし")
    : live?.band.name ?? "—";
  const nextHeaderEntry = liveIsActiveSlot ? nextLive : live;
  const matchingSheet = selected ? sheets.find((sheet) => normalizeSheetName(sheet.name) === normalizeSheetName(selected.band.name)) ?? null : null;
  const nextSelectedSheet = scheduled[selectedIndex + 1]
    ? sheets.find((sheet) => normalizeSheetName(sheet.name) === normalizeSheetName(scheduled[selectedIndex + 1].band.name)) ?? null
    : null;

  useEffect(() => {
    if (!nextSelectedSheet) return;
    if (nextSelectedSheet.kind === "image") {
      const image = new Image();
      image.src = nextSelectedSheet.url;
      return;
    }
    const controller = new AbortController();
    void fetch(nextSelectedSheet.url, { signal: controller.signal }).catch(() => undefined);
    return () => controller.abort();
  }, [nextSelectedSheet]);

  const countdownTarget = progress?.phase === "performing" && liveIsActiveSlot && live
    ? dateAtTime(live.day, live.slot.endTime)
    : nextHeaderEntry ? dateAtTime(nextHeaderEntry.day, nextHeaderEntry.slot.startTime) : null;
  const countdownLabel = progress?.phase === "performing" ? "終了まで" : "次の開始まで";

  const join = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("room", id);
    window.history.replaceState(null, "", url.toString());
    setRoomId(id);
  };
  const leave = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("room");
    window.history.replaceState(null, "", url.toString());
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
          : <div className="h-full min-h-0"><div className="flex h-10 items-center justify-between border-b border-slate-800 bg-slate-900 px-3"><p className="truncate text-sm font-bold"><span className="mr-2 text-xs text-slate-500">表示中</span>{selected.band.name}</p><span className="shrink-0 text-[10px] font-semibold text-slate-500">ピンチ操作で拡大</span></div><div className="h-[calc(100%-2.5rem)]"><SheetViewer sheet={matchingSheet} sheetState={sheetState} bandName={selected.band.name} roomId={roomId} onRetry={() => setSheetRefresh((value) => value + 1)} /></div></div>}
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
