import { useMemo, useState } from "react";
import type { MemberFrameCount } from "../../store/useApplicationStore";
import { useIsMobile } from "../../hooks/useViewport";
import { Badge } from "./Badge";

interface Props {
  // Precomputed once by the parent (ApplicationManagerTab) and shared with
  // ApplicationTable's per-band high-participation counts, rather than
  // each recomputing computeMemberFrameCounts from the full application
  // list independently.
  frameCounts: Map<string, MemberFrameCount>;
  selectedMember: string | null;
  onSelectMember: (name: string) => void;
}

export function MemberFrameCounts({ frameCounts, selectedMember, onSelectMember }: Props) {
  const isMobile = useIsMobile();
  // Collapsed by default on mobile only — this chip list can run to
  // dozens of entries for a large event, easily pushing the applicant
  // table itself below the fold on a phone. Desktop's sidebar has room to
  // spare, so it stays permanently expanded there (no toggle at all,
  // matching how it always behaved before this).
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const counts = useMemo(() => {
    return [...frameCounts.entries()].sort(
      (a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0], "ja"),
    );
  }, [frameCounts]);

  if (counts.length === 0) return null;

  const heading = (
    <h2 className="text-xs font-semibold text-slate-400">
      メンバー別 出演枠数
      <span className="ml-1 font-normal text-slate-500">（クリックで参加バンドを絞り込み）</span>
    </h2>
  );

  const chipList = (
    <ul className="flex flex-wrap gap-1.5">
      {counts.map(([name, { count, grade }]) => {
        const isSelected = name === selectedMember;
        return (
          <li key={name}>
            <button
              type="button"
              onClick={() => onSelectMember(name)}
              aria-pressed={isSelected}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium md:min-h-0 ${
                isSelected
                  ? "border-indigo-400 bg-indigo-600 text-white"
                  : count >= 3
                    ? "border-amber-600 bg-amber-950/40 text-amber-300 hover:border-amber-400"
                    : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500"
              }`}
            >
              {/* Grade shown as an inline badge next to the name — not a
                  separate grouped section — so it costs no extra vertical
                  space over a flat chip list. */}
              {grade && <Badge tone="grade">{grade}</Badge>}
              <span>
                {name}: {count}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  if (!isMobile) {
    return (
      <div className="flex shrink-0 flex-col gap-1.5">
        {heading}
        {chipList}
      </div>
    );
  }

  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setMobileExpanded((v) => !v)}
        aria-expanded={mobileExpanded}
        className="flex min-h-11 items-center justify-between rounded-lg border border-slate-700 bg-slate-800 px-3 text-xs font-semibold text-slate-300"
      >
        <span>
          👥 メンバー別出演枠数を{mobileExpanded ? "隠す" : "表示"}
          <span className="ml-1 font-normal text-slate-500">（{counts.length}名）</span>
        </span>
        <span className="text-slate-500">{mobileExpanded ? "▲" : "▼"}</span>
      </button>
      {mobileExpanded && (
        <div className="flex flex-col gap-1.5">
          {heading}
          {chipList}
        </div>
      )}
    </div>
  );
}
