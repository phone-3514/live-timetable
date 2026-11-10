import { useMemo, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { findPlacementViolations } from "../utils/placementViolations";

function scrollToBand(bandId: string) {
  const el = document.getElementById(`band-slot-${bandId}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const classes = ["ring-4", "ring-rose-400", "ring-offset-2", "ring-offset-slate-900", "animate-pulse"];
  el.classList.add(...classes);
  window.setTimeout(() => el.classList.remove(...classes), 2500);
}

// 日時指定(出演可能日・NG/希望時間・理由メモ)を後から変えたとき、すでに置いてある
// 配置が新しい指定と矛盾していないかを常時チェックして、画面上部に大きく警告する。
// 閉じるボタンは無い — 矛盾が解消されれば自動で消える。折りたたみだけ可能。
export function PlacementViolationBanner() {
  const bands = useAppStore((s) => s.bands);
  const days = useAppStore((s) => s.days);
  const venueHours = useAppStore((s) => s.venueHours);
  const [collapsed, setCollapsed] = useState(false);

  const violations = useMemo(
    () => findPlacementViolations(days, bands ?? [], venueHours),
    [days, bands, venueHours],
  );
  if (violations.length === 0) return null;

  return (
    <div
      role="alert"
      className="mb-2 shrink-0 rounded-lg border-2 border-rose-500 bg-rose-950/80 p-3 shadow-lg shadow-rose-950/50"
    >
      <div className="flex items-start gap-2">
        <span className="text-2xl leading-none" aria-hidden="true">
          🚨
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-rose-100">
            日時指定と矛盾している配置が {violations.length} 件あります。今すぐ変更してください
          </p>
          <p className="mt-0.5 text-xs text-rose-200/80">
            時間指定を変更した結果、すでに置いたバンドが出演できない日・時間に入っています。
            解消すると、この警告は自動で消えます。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="shrink-0 rounded border border-rose-400/60 px-2 py-1 text-xs text-rose-100 hover:bg-rose-900/60"
        >
          {collapsed ? "一覧を開く" : "折りたたむ"}
        </button>
      </div>
      {!collapsed && (
        <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto">
          {violations.map((v) => (
            <li
              key={v.slotId}
              className="flex items-center gap-2 rounded-md bg-rose-900/40 px-2.5 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm text-rose-50">
                  <span className="font-semibold">{v.bandName}</span>
                  <span className="ml-2 text-xs text-rose-200">
                    {v.dayLabel} {v.startTime || "—"}
                    {v.endTime ? `–${v.endTime}` : ""}
                  </span>
                </div>
                <div className="text-xs text-rose-200">{v.reasons.join(" ／ ")}</div>
              </div>
              <button
                type="button"
                onClick={() => scrollToBand(v.bandId)}
                className="shrink-0 rounded bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-500"
              >
                場所を表示
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
