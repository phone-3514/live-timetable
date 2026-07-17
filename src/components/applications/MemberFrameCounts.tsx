import { useMemo } from "react";
import type { Application } from "../../types";
import { computeMemberFrameCounts } from "../../store/useApplicationStore";
import { Badge } from "./Badge";

interface Props {
  applications: Application[];
  selectedMember: string | null;
  onSelectMember: (name: string) => void;
}

export function MemberFrameCounts({ applications, selectedMember, onSelectMember }: Props) {
  const counts = useMemo(() => {
    const map = computeMemberFrameCounts(applications);
    return [...map.entries()].sort(
      (a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0], "ja"),
    );
  }, [applications]);

  if (counts.length === 0) return null;

  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      <h2 className="text-xs font-semibold text-slate-400">
        メンバー別 出演枠数
        <span className="ml-1 font-normal text-slate-500">
          （クリックで参加バンドを絞り込み）
        </span>
      </h2>
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
    </div>
  );
}
