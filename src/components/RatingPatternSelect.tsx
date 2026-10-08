import { useAppStore } from "../store/useAppStore";
import type { RatingPattern } from "../utils/autoScheduleSolver";

const OPTIONS: { value: RatingPattern; label: string; title: string }[] = [
  {
    value: "ascending",
    label: "評価：段階的に上げる",
    title: "評価1→5へだんだん上がるように並べます。ブロックの最後に高評価のバンドを置きます",
  },
  {
    value: "spread",
    label: "評価：高評価を散りばめる",
    title:
      "高評価（4〜5）のバンドを全体に均等に散らし、それ以外は低評価で埋めます。休憩前2バンドと終演前2バンドは必ず高評価にします",
  },
];

// How 一括自動配置 lays out the organizer's 1〜5 ratings.
export function RatingPatternSelect({ className = "" }: { className?: string }) {
  const ratingPattern = useAppStore((s) => s.ratingPattern);
  const setRatingPattern = useAppStore((s) => s.setRatingPattern);
  return (
    <select
      value={ratingPattern}
      onChange={(e) => setRatingPattern(e.target.value as RatingPattern)}
      aria-label="評価（5段階）の並べ方"
      title={OPTIONS.find((o) => o.value === ratingPattern)?.title}
      className={`min-h-11 rounded border border-slate-600 bg-slate-800 px-2 text-xs text-slate-200 outline-none focus:border-indigo-500 md:min-h-0 md:py-1.5 ${className}`}
    >
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value} title={o.title}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
