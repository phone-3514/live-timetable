import type { ReactNode } from "react";

// Semantic color families so a glance at a badge's color alone tells you
// its category, before even reading the text: Part = brand indigo, Grade =
// neutral slate (informational, not an action or a signal), Sync = a
// distinct violet family (matches the 🔌 sync indicators used elsewhere in
// the Timetable Editor), Status = green/red like everywhere else "approved
// vs. needs attention" is shown in this app.
export type BadgeTone =
  | "part"
  | "grade"
  | "sync-on"
  | "sync-off"
  | "status-approved"
  | "status-pending";

const TONE_CLASSES: Record<BadgeTone, string> = {
  part: "bg-indigo-950 text-indigo-200 border border-indigo-600",
  grade: "bg-slate-700 text-slate-100 border border-slate-500",
  "sync-on": "bg-violet-950 text-violet-200 border border-violet-500",
  "sync-off": "bg-slate-800 text-slate-400 border border-slate-600",
  "status-approved": "bg-emerald-950 text-emerald-200 border border-emerald-500",
  "status-pending": "bg-slate-800 text-slate-400 border border-slate-600",
};

interface Props {
  tone: BadgeTone;
  children: ReactNode;
  className?: string;
}

// Shared pill/tag element for every badge in the Application Manager (and
// anywhere else that wants the same look) — high-contrast semantic bg,
// semibold text sized to stay readable on mobile, generous padding so the
// text has room to breathe, fully rounded for a clearly "this is a tag,
// not prose" shape.
export function Badge({ tone, children, className = "" }: Props) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold leading-none ${TONE_CLASSES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
