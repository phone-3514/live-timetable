import { useMemo, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { TIME_RESTRICTION_BUFFER_MINUTES } from "../utils/memberConstraints";
import { findPlacementViolations, type PlacementViolation } from "../utils/placementViolations";

function scrollToBand(bandId: string, color: "rose" | "amber") {
  const el = document.getElementById(`band-slot-${bandId}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  // Tailwind は動的に組み立てたクラス名を生成しないので、色ごとに文字列で書く。
  const ring = color === "rose" ? "ring-rose-400" : "ring-amber-400";
  const classes = ["ring-4", ring, "ring-offset-2", "ring-offset-slate-900", "animate-pulse"];
  el.classList.add(...classes);
  window.setTimeout(() => el.classList.remove(...classes), 2500);
}

const TONE = {
  rose: {
    box: "border-rose-500 bg-rose-950/80 shadow-rose-950/50",
    title: "text-rose-100",
    sub: "text-rose-200/80",
    row: "bg-rose-900/40",
    rowText: "text-rose-50",
    rowSub: "text-rose-200",
    btn: "bg-rose-600 hover:bg-rose-500 text-white",
    toggle: "border-rose-400/60 text-rose-100 hover:bg-rose-900/60",
  },
  amber: {
    box: "border-amber-500 bg-amber-950/70 shadow-amber-950/40",
    title: "text-amber-100",
    sub: "text-amber-200/80",
    row: "bg-amber-900/30",
    rowText: "text-amber-50",
    rowSub: "text-amber-200",
    btn: "bg-amber-500 hover:bg-amber-400 text-amber-950",
    toggle: "border-amber-400/60 text-amber-100 hover:bg-amber-900/60",
  },
} as const;

function Section({
  tone,
  icon,
  title,
  note,
  items,
}: {
  tone: "rose" | "amber";
  icon: string;
  title: string;
  note: string;
  items: PlacementViolation[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const t = TONE[tone];
  return (
    <div role="alert" className={`mb-2 shrink-0 rounded-lg border-2 p-3 shadow-lg ${t.box}`}>
      <div className="flex items-start gap-2">
        <span className="text-2xl leading-none" aria-hidden="true">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`font-bold ${tone === "rose" ? "text-base" : "text-sm"} ${t.title}`}>{title}</p>
          <p className={`mt-0.5 text-xs ${t.sub}`}>{note}</p>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className={`shrink-0 rounded border px-2 py-1 text-xs ${t.toggle}`}
        >
          {collapsed ? "一覧を開く" : "折りたたむ"}
        </button>
      </div>
      {!collapsed && (
        <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto">
          {items.map((v) => (
            <li key={v.slotId} className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 ${t.row}`}>
              <div className="min-w-0 flex-1">
                <div className={`text-sm ${t.rowText}`}>
                  <span className="font-semibold">{v.bandName}</span>
                  <span className={`ml-2 text-xs ${t.rowSub}`}>
                    {v.dayLabel} {v.startTime || "—"}
                    {v.endTime ? `–${v.endTime}` : ""}
                  </span>
                </div>
                <div className={`text-xs ${t.rowSub}`}>{v.reasons.join(" ／ ")}</div>
              </div>
              <button
                type="button"
                onClick={() => scrollToBand(v.bandId, tone)}
                className={`shrink-0 rounded px-2.5 py-1.5 text-xs font-semibold ${t.btn}`}
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

// 日時指定(出演可能日・NG/希望時間・理由メモ)を後から変えたとき、すでに置いてある
// 配置が新しい指定と矛盾していないかを常時チェックして、画面上部に大きく警告する。
//  - 赤: 指定そのものに反している(今すぐ変更)
//  - 黄: 指定には収まっているが、前後 TIME_RESTRICTION_BUFFER_MINUTES 分の余裕がない
// 閉じるボタンは無い — 解消されれば自動で消える。折りたたみだけ可能。
export function PlacementViolationBanner() {
  const bands = useAppStore((s) => s.bands);
  const days = useAppStore((s) => s.days);
  const venueHours = useAppStore((s) => s.venueHours);

  const { violations, tight } = useMemo(() => {
    const all = findPlacementViolations(days, bands ?? [], venueHours);
    return {
      violations: all.filter((v) => v.severity === "violation"),
      tight: all.filter((v) => v.severity === "tight"),
    };
  }, [days, bands, venueHours]);

  if (violations.length === 0 && tight.length === 0) return null;
  return (
    <>
      {violations.length > 0 && (
        <Section
          tone="rose"
          icon="🚨"
          title={`日時指定と矛盾している配置が ${violations.length} 件あります。今すぐ変更してください`}
          note="時間指定を変更した結果、すでに置いたバンドが出演できない日・時間に入っています。解消すると、この警告は自動で消えます。"
          items={violations}
        />
      )}
      {tight.length > 0 && (
        <Section
          tone="amber"
          icon="⚠️"
          title={`時間指定の前後${TIME_RESTRICTION_BUFFER_MINUTES}分未満の配置が ${tight.length} 件あります`}
          note={`指定の範囲には収まっていますが、NG・希望時間の端まで${TIME_RESTRICTION_BUFFER_MINUTES}分以上の余裕がありません。進行が押す・早まると外れる恐れがあります。`}
          items={tight}
        />
      )}
    </>
  );
}
