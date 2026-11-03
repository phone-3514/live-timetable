import { useMemo } from "react";
import { useApplicationStore } from "../../store/useApplicationStore";
import { normalizeMemberName } from "../../utils/normalizeMemberName";

// The 個人に紐づけた理由メモ of whichever of `memberNames` have one — a reason
// that belongs to a person shows up on every band they're in.
export function useMemberReasonNotesFor(memberNames: string[]): { name: string; note: string }[] {
  const notes = useApplicationStore((s) => s.memberReasonNotes);
  return useMemo(() => {
    const byKey = new Map((notes ?? []).map((n) => [n.key, n]));
    const seen = new Set<string>();
    const result: { name: string; note: string }[] = [];
    for (const raw of memberNames) {
      const key = normalizeMemberName(raw);
      const entry = key ? byKey.get(key) : undefined;
      if (entry && !seen.has(key)) {
        seen.add(key);
        result.push({ name: raw, note: entry.note });
      }
    }
    return result;
  }, [notes, memberNames]);
}

export function MemberReasonNotesLine({ memberNames }: { memberNames: string[] }) {
  const entries = useMemberReasonNotesFor(memberNames);
  if (entries.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-[11px] text-amber-300/90">
      {entries.map((e) => (
        <li key={e.name} className="whitespace-pre-wrap break-words">
          👤 {e.name}：{e.note}
        </li>
      ))}
    </ul>
  );
}
