import { useState } from "react";
import type { ReactNode } from "react";
import App from "../App";
import { useSyncAccessibility } from "../hooks/useSyncAccessibility";
import { useSyncThemeAttribute } from "../hooks/useSyncThemeAttribute";
import { useAppStore } from "../store/useAppStore";
import { useUiStore } from "../store/useUiStore";
import type { Band, TimetableDay } from "../types";
import { AccessibilitySettings } from "./AccessibilitySettings";
import { ThemeToggle } from "./ThemeToggle";

type EntryView = "landing" | "create" | "organizer" | "public" | "editor";

type CreationDraft = {
  eventName: string;
  date: string;
  venue: string;
  startTime: string;
  plannedEndTime: string;
  firstBandName: string;
};

const INITIAL_DRAFT: CreationDraft = {
  eventName: "",
  date: "",
  venue: "",
  startTime: "10:00",
  plannedEndTime: "21:00",
  firstBandName: "",
};

function normalizeCode(value: string): string | null {
  const normalized = value.trim().replace(/[\s-]+/g, "").toLowerCase();
  return /^[a-z0-9]{8}$/.test(normalized) ? normalized : null;
}

function destinationForCode(kind: "organizer" | "public", code: string): string {
  const base = import.meta.env.BASE_URL;
  return kind === "organizer"
    ? `${base}?room=${encodeURIComponent(code)}`
    : `${base}${encodeURIComponent(code)}/public`;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="flex min-h-16 items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3">
        <div>
          <p className="text-sm font-bold tracking-tight">Live Timetable</p>
          <p className="text-[11px] text-slate-500">イベント運営を始める</p>
        </div>
        <div className="flex items-center gap-2">
          <AccessibilitySettings />
          <ThemeToggle />
        </div>
      </header>
      {children}
    </div>
  );
}

function Landing({ onSelect }: { onSelect: (view: EntryView) => void }) {
  const eventInfo = useAppStore((state) => state.eventInfo);
  const bands = useAppStore((state) => state.bands);
  const days = useAppStore((state) => state.days);
  const hasLocalEvent = Boolean(
    eventInfo.liveName.trim() ||
      eventInfo.venue.trim() ||
      bands.length ||
      days.some((day) => day.slots.length),
  );

  return (
    <Shell>
      <main className="mx-auto w-full max-w-xl px-4 py-8 sm:py-12">
        <div className="mb-7">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-300">Choose your role</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">どの方法で始めますか？</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">目的に合った入口を選んでください。</p>
        </div>

        {hasLocalEvent && (
          <section className="mb-5 rounded-xl border border-indigo-500/60 bg-indigo-950/35 p-4 shadow-sm">
            <p className="text-xs font-semibold text-indigo-300">この端末に保存済み</p>
            <p className="mt-1 truncate text-base font-bold">{eventInfo.liveName || "名称未設定のイベント"}</p>
            <button
              type="button"
              onClick={() => onSelect("editor")}
              className="mt-4 min-h-12 w-full rounded-lg bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-500"
            >
              保存中のイベントを再開
            </button>
          </section>
        )}

        <button
          type="button"
          onClick={() => onSelect("public")}
          className="flex min-h-24 w-full items-center gap-4 rounded-xl border border-indigo-500/70 bg-indigo-950/40 p-4 text-left shadow-sm hover:bg-indigo-950/65"
        >
          <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-indigo-500/20 text-2xl text-indigo-200">▤</span>
          <span className="min-w-0 flex-1">
            <strong className="block text-base text-slate-100">タイムテーブルを見る</strong>
            <span className="mt-1 block text-xs leading-relaxed text-slate-300">閲覧コードから読み取り専用画面を開きます</span>
          </span>
          <span aria-hidden="true" className="text-xl text-indigo-300">›</span>
        </button>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={() => onSelect("organizer")} className="min-h-12 rounded-lg border border-slate-700 bg-slate-900 px-4 text-sm font-semibold text-slate-300 hover:bg-slate-800">運営スタッフはこちら</button>
          <button type="button" onClick={() => window.location.assign(`${import.meta.env.BASE_URL}pa-viewer`)} className="min-h-12 rounded-lg border border-slate-700 bg-slate-900 px-4 text-sm font-semibold text-slate-300 hover:bg-slate-800">PA／ローディーはこちら</button>
        </div>
        <button type="button" onClick={() => onSelect("create")} className="mt-3 min-h-11 w-full rounded-lg px-4 text-sm font-semibold text-slate-400 hover:bg-slate-900 hover:text-slate-200">イベントを作成・管理</button>
      </main>
    </Shell>
  );
}

function CodeEntry({ kind, onBack }: { kind: "organizer" | "public"; onBack: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const isOrganizer = kind === "organizer";

  return (
    <Shell>
      <main className="mx-auto w-full max-w-md px-4 py-8 sm:py-12">
        <button type="button" onClick={onBack} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-slate-400 hover:bg-slate-800 hover:text-slate-100">
          ← 戻る
        </button>
        <h1 className="mt-6 text-2xl font-bold">{isOrganizer ? "運営スタッフとして参加" : "タイムテーブルを見る"}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          主催者から共有された8文字のコードを入力してください。
        </p>
        {isOrganizer && <p className="mt-4 rounded-lg border border-amber-700/70 bg-amber-950/30 p-3 text-sm font-semibold leading-relaxed text-amber-200">運営スタッフ専用です。一般部員には共有しないでください。</p>}
        <form
          className="mt-8"
          onSubmit={(event) => {
            event.preventDefault();
            const normalized = normalizeCode(code);
            if (!normalized) {
              setError("8文字の共有コードを確認してください");
              return;
            }
            window.location.assign(destinationForCode(kind, normalized));
          }}
        >
          <label htmlFor={`${kind}-code`} className="text-sm font-semibold text-slate-200">{isOrganizer ? "運営スタッフ専用コード" : "閲覧コード"}</label>
          <input
            id={`${kind}-code`}
            value={code}
            onChange={(event) => {
              setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9\s-]/g, ""));
              setError("");
            }}
            autoFocus
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            maxLength={11}
            placeholder="例：ABCD2345"
            aria-describedby={error ? `${kind}-code-error` : undefined}
            className="mt-2 min-h-14 w-full rounded-xl border border-slate-600 bg-slate-900 px-4 font-mono text-lg font-bold uppercase tracking-[0.16em] text-slate-100 outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-slate-600 focus:border-indigo-500"
          />
          {error && <p id={`${kind}-code-error`} className="mt-2 text-sm text-rose-400">{error}</p>}
          <button type="submit" className="mt-6 min-h-12 w-full rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-500">
            {isOrganizer ? "運営画面へ進む" : "タイムテーブルを見る"}
          </button>
        </form>
      </main>
    </Shell>
  );
}

function StepProgress({ step }: { step: number }) {
  return (
    <div aria-label={`全4ステップ中${step}ステップ目`} className="mb-8">
      <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-400">
        <span>イベント作成</span>
        <span>{step} / 4</span>
      </div>
      <div className="grid grid-cols-4 gap-2" aria-hidden="true">
        {[1, 2, 3, 4].map((item) => (
          <span key={item} className={`h-1.5 rounded-full ${item <= step ? "bg-indigo-500" : "bg-slate-800"}`} />
        ))}
      </div>
    </div>
  );
}

function EventCreation({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState(INITIAL_DRAFT);
  const [error, setError] = useState("");

  function update<K extends keyof CreationDraft>(key: K, value: CreationDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setError("");
  }

  function goNext() {
    if (step === 1 && !draft.eventName.trim()) {
      setError("イベント名を入力してください");
      return;
    }
    if (step === 2 && draft.plannedEndTime <= draft.startTime) {
      setError("終了予定時刻は開始時刻より後にしてください");
      return;
    }
    setStep((current) => Math.min(4, current + 1));
  }

  function createEvent() {
    const dayId = crypto.randomUUID();
    const day: TimetableDay = {
      id: dayId,
      label: "1日目",
      date: draft.date || null,
      settings: { startTime: draft.startTime, performanceMinutes: 20, transitionMinutes: 15 },
      slots: [],
    };

    useAppStore.setState({
      bands: [],
      days: [day],
      venueHours: { openTime: draft.startTime, closeTime: draft.plannedEndTime },
      eventInfo: { liveName: draft.eventName.trim(), venue: draft.venue.trim(), organizationName: "" },
      lastDeleted: null,
    });

    const bandName = draft.firstBandName.trim();
    if (bandName) {
      const band: Band = {
        id: crypto.randomUUID(),
        name: bandName,
        members: [],
        setlist: [],
        desiredTime: "",
        ngTime: "",
        allowedDayIds: [],
        hasSync: false,
        hasKeyboard: false,
        gearTags: [],
        raw: bandName,
      };
      const store = useAppStore.getState();
      store.addBands([band]);
      store.addSlot(dayId);
      const slotId = useAppStore.getState().days[0]?.slots[0]?.id;
      if (slotId) useAppStore.getState().assignBandToSlot(band.id, slotId);
    }
    useUiStore.getState().setActiveTab("timetable");
    onCreated();
  }

  return (
    <Shell>
      <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-lg flex-col px-4 py-7 sm:py-10">
        <StepProgress step={step} />

        <div className="flex-1">
          {step === 1 && (
            <section>
              <h1 className="text-2xl font-bold">基本情報</h1>
              <p className="mt-2 text-sm text-slate-400">まずイベントの名前と開催情報を入力します。</p>
              <div className="mt-7 grid gap-5">
                <label className="text-sm font-semibold text-slate-200">イベント名 <span className="text-rose-400">必須</span>
                  <input autoFocus value={draft.eventName} onChange={(event) => update("eventName", event.target.value)} placeholder="例：軽音祭 vol.5" className="mt-2 min-h-12 w-full rounded-xl border border-slate-600 bg-slate-900 px-4 text-slate-100 outline-none placeholder:text-slate-600 focus:border-indigo-500" />
                </label>
                <label className="text-sm font-semibold text-slate-200">開催日
                  <input type="date" value={draft.date} onChange={(event) => update("date", event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-600 bg-slate-900 px-4 text-slate-100 outline-none focus:border-indigo-500" />
                </label>
                <label className="text-sm font-semibold text-slate-200">会場
                  <input value={draft.venue} onChange={(event) => update("venue", event.target.value)} placeholder="会場名" className="mt-2 min-h-12 w-full rounded-xl border border-slate-600 bg-slate-900 px-4 text-slate-100 outline-none placeholder:text-slate-600 focus:border-indigo-500" />
                </label>
              </div>
            </section>
          )}

          {step === 2 && (
            <section>
              <h1 className="text-2xl font-bold">スケジュール</h1>
              <p className="mt-2 text-sm text-slate-400">初日の基本時間を設定します。あとから編集できます。</p>
              <div className="mt-7 grid gap-5">
                <label className="text-sm font-semibold text-slate-200">開催日
                  <input type="date" value={draft.date} onChange={(event) => update("date", event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-600 bg-slate-900 px-4 text-slate-100 outline-none focus:border-indigo-500" />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm font-semibold text-slate-200">開始時刻
                    <input type="time" value={draft.startTime} onChange={(event) => update("startTime", event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 text-slate-100 outline-none focus:border-indigo-500" />
                  </label>
                  <label className="text-sm font-semibold text-slate-200">終了予定
                    <input type="time" value={draft.plannedEndTime} onChange={(event) => update("plannedEndTime", event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 text-slate-100 outline-none focus:border-indigo-500" />
                  </label>
                </div>
              </div>
            </section>
          )}

          {step === 3 && (
            <section>
              <h1 className="text-2xl font-bold">最初のバンド</h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">最初の出演バンドを登録できます。未定なら空欄のまま進めます。</p>
              <label className="mt-7 block text-sm font-semibold text-slate-200">バンド名
                <input autoFocus value={draft.firstBandName} onChange={(event) => update("firstBandName", event.target.value)} placeholder="バンド名を入力" className="mt-2 min-h-12 w-full rounded-xl border border-slate-600 bg-slate-900 px-4 text-slate-100 outline-none placeholder:text-slate-600 focus:border-indigo-500" />
              </label>
            </section>
          )}

          {step === 4 && (
            <section>
              <h1 className="text-2xl font-bold">確認</h1>
              <p className="mt-2 text-sm text-slate-400">この内容でイベントを作成します。</p>
              <dl className="mt-7 divide-y divide-slate-800 rounded-xl border border-slate-700 bg-slate-900 px-4">
                {[
                  ["イベント名", draft.eventName],
                  ["開催日", draft.date || "未設定"],
                  ["会場", draft.venue || "未設定"],
                  ["予定時間", `${draft.startTime} 〜 ${draft.plannedEndTime}`],
                  ["最初のバンド", draft.firstBandName.trim() || "あとで登録"],
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[7rem_1fr] gap-3 py-4">
                    <dt className="text-xs font-semibold text-slate-500">{label}</dt>
                    <dd className="break-words text-sm font-semibold text-slate-100">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>

        {error && <p role="alert" className="mt-5 rounded-lg border border-rose-900/70 bg-rose-950/30 p-3 text-sm text-rose-300">{error}</p>}
        <div className="mt-7 flex items-center gap-3 border-t border-slate-800 pt-5">
          <button
            type="button"
            onClick={() => (step === 1 ? onCancel() : setStep((current) => current - 1))}
            className="min-h-12 rounded-xl border border-slate-700 px-4 text-sm font-semibold text-slate-300 hover:bg-slate-800"
          >
            {step === 1 ? "キャンセル" : "戻る"}
          </button>
          <button
            type="button"
            onClick={step === 4 ? createEvent : goNext}
            className="min-h-12 flex-1 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-500"
          >
            {step === 4 ? "イベントを作成" : step === 3 && !draft.firstBandName.trim() ? "あとで登録して次へ" : "次へ"}
          </button>
        </div>
      </main>
    </Shell>
  );
}

export function AppEntry({ bypassLanding }: { bypassLanding: boolean }) {
  const [view, setView] = useState<EntryView>(bypassLanding ? "editor" : "landing");
  useSyncThemeAttribute();
  useSyncAccessibility();

  if (view === "editor") return <App />;
  if (view === "create") return <EventCreation onCancel={() => setView("landing")} onCreated={() => setView("editor")} />;
  if (view === "organizer" || view === "public") return <CodeEntry kind={view} onBack={() => setView("landing")} />;
  return <Landing onSelect={setView} />;
}
