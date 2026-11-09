import { useMemo, useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useEscapeKey } from "../hooks/useEscapeKey";
import {
  findSharedMemberPairs,
  type BandPlacement,
  type SharedMemberPair,
} from "../utils/sharedMemberBands";
import { ModalPortal } from "./ModalPortal";

interface Props {
  onClose: () => void;
}

const MIN_OPTIONS = [2, 3, 4] as const;

function placementText(p: BandPlacement | null): string {
  return p ? `${p.dayLabel} ${p.startTime}–${p.endTime}` : "未配置";
}

function BandSide({ name, placement }: { name: string; placement: BandPlacement | null }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="truncate text-sm font-semibold text-slate-100" title={name}>
        {name}
      </div>
      <div className={`text-[11px] ${placement ? "text-slate-400" : "text-slate-500"}`}>
        {placementText(placement)}
      </div>
    </div>
  );
}

function PairCard({ pair }: { pair: SharedMemberPair }) {
  return (
    <li
      className={`rounded-md border p-2.5 ${
        pair.adjacent ? "border-rose-700 bg-rose-950/20" : "border-slate-700 bg-slate-800/40"
      }`}
    >
      <div className="flex items-center gap-2">
        <BandSide name={pair.a.name} placement={pair.placementA} />
        <span className="shrink-0 text-slate-500" aria-hidden="true">
          ⇄
        </span>
        <BandSide name={pair.b.name} placement={pair.placementB} />
        <span className="shrink-0 rounded-full bg-indigo-950/70 px-2 py-0.5 text-[11px] font-semibold text-indigo-300">
          共通 {pair.sharedNames.length}人
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {pair.sharedNames.map((n) => (
          <span key={n} className="rounded bg-slate-700 px-1.5 py-0.5 text-[11px] text-slate-200">
            {n}
          </span>
        ))}
        {pair.adjacent && (
          <span className="rounded-full bg-rose-950/60 px-2 py-0.5 text-[11px] font-semibold text-rose-300">
            連続枠
          </span>
        )}
      </div>
    </li>
  );
}

// メンバーが重なっているバンドの組の一覧。掛け持ち確認(ScheduleReviewModal)は
// 「人」単位だが、こちらは「どのバンドとどのバンドが同じ人を共有しているか」を
// バンド単位で見る — 2人以上重なるバンド同士は、ほぼ同じメンバーの別ユニットで
// 出番が近いと負担が大きい、といった判断に使う。
export function SharedMemberBandsModal({ onClose }: Props) {
  const bands = useAppStore((s) => s.bands);
  const days = useAppStore((s) => s.days);
  const [minShared, setMinShared] = useState<number>(2);
  const [query, setQuery] = useState("");
  const downOnBackdrop = useRef(false);
  useEscapeKey(onClose);

  const pairs = useMemo(() => findSharedMemberPairs(bands, days, minShared), [bands, days, minShared]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pairs;
    return pairs.filter(
      (p) =>
        p.a.name.toLowerCase().includes(q) ||
        p.b.name.toLowerCase().includes(q) ||
        p.sharedNames.some((n) => n.toLowerCase().includes(q)),
    );
  }, [pairs, query]);

  const bandCount = useMemo(() => {
    const ids = new Set<string>();
    for (const p of pairs) {
      ids.add(p.a.id);
      ids.add(p.b.id);
    }
    return ids.size;
  }, [pairs]);
  const adjacentCount = pairs.filter((p) => p.adjacent).length;

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => {
          downOnBackdrop.current = e.target === e.currentTarget;
        }}
        onClick={(e) => {
          // ドラッグでの文字選択がバックドロップ上で終わっても閉じないよう、
          // 押下もバックドロップだったときだけ閉じる。
          if (e.target === e.currentTarget && downOnBackdrop.current) onClose();
        }}
      >
        <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">👥 メンバー重複バンド</h2>
              <p className="mt-1 text-xs text-slate-400">
                同じメンバーが複数のバンドに入っている組を、共通人数の多い順に表示します。
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg leading-none text-slate-500 hover:bg-slate-700 hover:text-slate-300"
              title="閉じる"
            >
              ×
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400">共通メンバー</span>
            <div className="flex overflow-hidden rounded border border-slate-600">
              {MIN_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMinShared(n)}
                  className={`px-2.5 py-1 ${
                    minShared === n
                      ? "bg-indigo-600 text-white"
                      : "text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {n}人以上
                </button>
              ))}
            </div>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="バンド名・メンバーで検索"
              className="min-w-0 flex-1 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-100 placeholder:text-slate-500"
            />
          </div>

          <p className="mt-2 text-[11px] text-slate-500">
            {pairs.length}組（{bandCount}バンド）
            {adjacentCount > 0 && (
              <span className="ml-1.5 rounded-full bg-rose-950/60 px-2 py-0.5 font-semibold text-rose-300">
                連続枠 {adjacentCount}組
              </span>
            )}
            {query.trim() && ` ／ 絞り込み ${shown.length}組`}
          </p>

          <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
            {shown.length === 0 ? (
              <p className="rounded-md border border-slate-700 px-3 py-4 text-center text-xs text-slate-500">
                {pairs.length === 0
                  ? `共通メンバーが${minShared}人以上のバンドはありません`
                  : "該当するバンドがありません"}
              </p>
            ) : (
              <ul className="space-y-2">
                {shown.map((p) => (
                  <PairCard key={`${p.a.id}|${p.b.id}`} pair={p} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
