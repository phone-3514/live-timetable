import { useMemo } from "react";
import type { Application } from "../../types";
import { computeMemberFrameCounts } from "../../store/useApplicationStore";

interface Props {
  applications: Application[];
  selectedMember: string | null;
  onSelectMember: (name: string) => void;
}

export function MemberFrameCounts({ applications, selectedMember, onSelectMember }: Props) {
  const counts = useMemo(() => {
    const map = computeMemberFrameCounts(applications);
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"));
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
        {counts.map(([name, count]) => {
          const isSelected = name === selectedMember;
          return (
            <li key={name}>
              <button
                type="button"
                onClick={() => onSelectMember(name)}
                aria-pressed={isSelected}
                className={
                  isSelected
                    ? "rounded-full border border-indigo-400 bg-indigo-600 px-2.5 py-0.5 text-xs text-white"
                    : count >= 3
                      ? "rounded-full border border-amber-600 bg-amber-950/40 px-2.5 py-0.5 text-xs text-amber-300 hover:border-amber-400"
                      : "rounded-full border border-slate-700 bg-slate-800 px-2.5 py-0.5 text-xs text-slate-300 hover:border-slate-500"
                }
              >
                {name}: {count}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
