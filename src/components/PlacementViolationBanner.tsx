import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { TIME_RESTRICTION_BUFFER_MINUTES } from "../utils/memberConstraints";
import { findPlacementViolations, type PlacementViolation } from "../utils/placementViolations";
import { ModalPortal } from "./ModalPortal";

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
    box: "border-rose-500 bg-rose-950/95",
    title: "text-rose-100",
    sub: "text-rose-200/80",
    row: "bg-rose-900/40",
    rowText: "text-rose-50",
    rowSub: "text-rose-200",
    btn: "bg-rose-600 hover:bg-rose-500 text-white",
  },
  amber: {
    box: "border-amber-500 bg-amber-950/95",
    title: "text-amber-100",
    sub: "text-amber-200/80",
    row: "bg-amber-900/30",
    rowText: "text-amber-50",
    rowSub: "text-amber-200",
    btn: "bg-amber-500 hover:bg-amber-400 text-amber-950",
  },
} as const;

function Section({
  tone,
  icon,
  title,
  note,
  items,
  onJump,
}: {
  tone: "rose" | "amber";
  icon: string;
  title: string;
  note: string;
  items: PlacementViolation[];
  onJump: (v: PlacementViolation) => void;
}) {
  const t = TONE[tone];
  return (
    <div className={`rounded-lg border-2 p-3 ${t.box}`}>
      <div className="flex items-start gap-2">
        <span className="text-xl leading-none" aria-hidden="true">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-bold ${t.title}`}>{title}</p>
          <p className={`mt-0.5 text-xs ${t.sub}`}>{note}</p>
        </div>
      </div>
      <ul className="mt-2 space-y-1.5">
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
              onClick={() => onJump(v)}
              className={`min-h-9 shrink-0 rounded px-2.5 text-xs font-semibold ${t.btn}`}
            >
              場所を表示
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// 日時指定(出演可能日・NG/希望時間・理由メモ)を後から変えたとき、すでに置いてある配置が
// 新しい指定と矛盾していないかを常時チェックする。
//  - 赤: 指定そのものに反している(今すぐ変更)
//  - 黄: 指定には収まっているが、前後 TIME_RESTRICTION_BUFFER_MINUTES 分の余裕がない
// 画面を圧迫しないよう、ヘッダー内の小さなバッジにして、押すと下にポップアップで詳細を
// 開く(レイアウトは押し下げない)。矛盾が新しく増えたときだけ自動で開く。解消されれば
// バッジごと自動で消える。
export function PlacementViolationBanner() {
  const bands = useAppStore((s) => s.bands);
  const days = useAppStore((s) => s.days);
  const venueHours = useAppStore((s) => s.venueHours);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const prevViolationCount = useRef<number | null>(null);

  const { violations, tight } = useMemo(() => {
    const all = findPlacementViolations(days, bands ?? [], venueHours);
    return {
      violations: all.filter((v) => v.severity === "violation"),
      tight: all.filter((v) => v.severity === "tight"),
    };
  }, [days, bands, venueHours]);

  // 赤(矛盾)が新しく増えたときだけ自動で開く。最初の表示では開かない。
  useEffect(() => {
    if (prevViolationCount.current !== null && violations.length > prevViolationCount.current) {
      setOpen(true);
    }
    prevViolationCount.current = violations.length;
  }, [violations.length]);

  // 何も無くなったら閉じておく(次に出たとき開きっぱなしにならないように)。
  useEffect(() => {
    if (violations.length === 0 && tight.length === 0) setOpen(false);
  }, [violations.length, tight.length]);

  const reposition = () => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const width = Math.min(720, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setPos({ top: rect.bottom + 8, left, width });
  };
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [open]);

  // ポップアップの外を押したら閉じる。
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEscapeKey(() => {
    if (open) setOpen(false);
  });

  if (violations.length === 0 && tight.length === 0) return null;

  const hasRed = violations.length > 0;
  const jump = (v: PlacementViolation) => {
    setOpen(false);
    scrollToBand(v.bandId, v.severity === "violation" ? "rose" : "amber");
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="日時指定と矛盾している配置（矛盾）と、指定の前後20分の余裕が足りない配置（余裕）を確認します"
        className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded border px-2 text-xs font-bold md:min-h-0 md:py-1.5 ${
          hasRed
            ? "border-rose-400 bg-rose-950/70 text-rose-100 hover:bg-rose-900/70"
            : "border-amber-400 bg-amber-950/60 text-amber-100 hover:bg-amber-900/60"
        }`}
      >
        {violations.length > 0 && (
          <span className="flex items-center gap-1">
            <span aria-hidden="true">🚨</span>
            <span className="hidden max-md:inline min-[1700px]:inline">矛盾</span>
            <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-black leading-none text-white">
              {violations.length}
            </span>
          </span>
        )}
        {tight.length > 0 && (
          // 幅の狭いデスクトップでは、赤があるときは赤だけ表示してツールバーを圧迫しない
          // (黄色の件数はポップアップを開けば分かる)。
          <span className={hasRed ? "hidden items-center gap-1 max-md:flex min-[1700px]:flex" : "flex items-center gap-1"}>
            <span aria-hidden="true">⚠</span>
            <span className="hidden max-md:inline min-[1700px]:inline">余裕</span>
            <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-black leading-none text-amber-950">
              {tight.length}
            </span>
          </span>
        )}
      </button>
      {open && pos && (
        <ModalPortal>
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="日時指定の警告"
            style={{ top: pos.top, left: pos.left, width: pos.width }}
            className="fixed z-[45] flex max-h-[calc(100vh-96px)] flex-col gap-2 overflow-y-auto rounded-xl border border-slate-600 bg-slate-900 p-2 shadow-2xl shadow-black/60"
          >
            <div className="flex items-center justify-between gap-2 px-1">
              <p className="text-xs font-semibold text-slate-300">日時指定の警告（解消すると自動で消えます）</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                title="閉じる"
                aria-label="閉じる"
              >
                ×
              </button>
            </div>
            {violations.length > 0 && (
              <Section
                tone="rose"
                icon="🚨"
                title={`日時指定と矛盾している配置が ${violations.length} 件あります。今すぐ変更してください`}
                note="時間指定を変更した結果、すでに置いたバンドが出演できない日・時間に入っています。"
                items={violations}
                onJump={jump}
              />
            )}
            {tight.length > 0 && (
              <Section
                tone="amber"
                icon="⚠️"
                title={`時間指定の前後${TIME_RESTRICTION_BUFFER_MINUTES}分未満の配置が ${tight.length} 件あります`}
                note={`指定の範囲には収まっていますが、NG・希望時間の端まで${TIME_RESTRICTION_BUFFER_MINUTES}分以上の余裕がありません。進行が押す・早まると外れる恐れがあります。`}
                items={tight}
                onJump={jump}
              />
            )}
          </div>
        </ModalPortal>
      )}
    </>
  );
}
