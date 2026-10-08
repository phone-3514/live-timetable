import type { Application } from "../types";
import type { MemberFrameCount } from "../store/useApplicationStore";
import { normalizeMemberName } from "./normalizeMemberName";

// How the rejection check decides who keeps a seat when there aren't enough:
// the band that sorts first is seated first, so whoever sorts last is the one
// turned away. Ties always fall back to 申請が早い順.
export type RejectionPolicy = "applied" | "grade" | "fewFrames" | "singleSlot" | "narrowWindow";

export const REJECTION_POLICIES: { value: RejectionPolicy; label: string; description: string }[] = [
  {
    value: "applied",
    label: "申請が早い順",
    description: "先に申請したバンドを優先して残し、遅い申請から却下します。",
  },
  {
    value: "grade",
    label: "学年が高い順（3→2→1）",
    description: "メンバーの平均学年が高いバンドを優先して残し、学年の低いバンドから却下します。",
  },
  {
    value: "fewFrames",
    label: "枠数が多い人がいるバンドから却下",
    description: "メンバーの最大枠数（掛け持ち数）が多いバンドから却下し、少ないバンドを残します。",
  },
  {
    value: "singleSlot",
    label: "1枠のみの人がいないバンドから却下",
    description:
      "1枠しか出ないメンバーがいるバンドを優先して残し、そういうメンバーがいないバンドから却下します。",
  },
  {
    value: "narrowWindow",
    label: "演奏可能な時間が短いバンドから却下",
    description:
      "日時指定で使える枠が少ない（演奏できる時間が短い）バンドから却下し、使える枠が多いバンドを残します。",
  },
];

export type BandMetrics = {
  /** Average grade of the members whose grade is known (0 = nobody's is). */
  gradeLevel: number;
  /** Largest number of bands any one member is in. */
  maxFrames: number;
  /** Has a member whose only band is this one. */
  hasSingleSlotMember: boolean;
  /** How many of the simulated slots its 日時指定 lets it play in (filled in
   * once the slots are known; 0 until then). */
  eligibleSlots: number;
};

// "3年" / "３年" → 3; 院・修士・博士・M1・D2 → 5 (above any undergraduate);
// anything else 0.
export function gradeLevel(grade: string): number {
  const g = grade.normalize("NFKC").trim();
  if (!g) return 0;
  if (/院|修|博|^[MD]\s*\d?/i.test(g)) return 5;
  const m = g.match(/\d+/);
  return m ? Number(m[0]) : 0;
}

export function computeBandMetrics(
  app: Application,
  frameCounts: Map<string, MemberFrameCount>,
): BandMetrics {
  let gradeSum = 0;
  let gradeCount = 0;
  let maxFrames = 0;
  let single = false;
  for (const member of app.members) {
    const level = gradeLevel(member.grade);
    if (level > 0) {
      gradeSum += level;
      gradeCount++;
    }
    const count = frameCounts.get(normalizeMemberName(member.name))?.count ?? 1;
    maxFrames = Math.max(maxFrames, count);
    if (count === 1) single = true;
  }
  return { gradeLevel: gradeCount > 0 ? gradeSum / gradeCount : 0, maxFrames, hasSingleSlotMember: single, eligibleSlots: 0 };
}

/** Negative = `a` is kept in preference to `b`. */
export function comparePriority(
  policy: RejectionPolicy,
  a: { app: Application; metrics: BandMetrics },
  b: { app: Application; metrics: BandMetrics },
): number {
  let primary = 0;
  if (policy === "grade") primary = b.metrics.gradeLevel - a.metrics.gradeLevel;
  else if (policy === "fewFrames") primary = a.metrics.maxFrames - b.metrics.maxFrames;
  else if (policy === "narrowWindow") primary = b.metrics.eligibleSlots - a.metrics.eligibleSlots;
  else if (policy === "singleSlot")
    primary = Number(b.metrics.hasSingleSlotMember) - Number(a.metrics.hasSingleSlotMember);
  if (primary !== 0) return primary;
  return (
    a.app.applicationDateTime.localeCompare(b.app.applicationDateTime) || a.app.createdAt - b.app.createdAt
  );
}

/** The one-line fact about a band that its position in the order came from. */
export function describePriorityBasis(
  policy: RejectionPolicy,
  app: Application,
  metrics: BandMetrics,
): string {
  const applied = app.applicationDateTime ? `申請日時 ${app.applicationDateTime}` : "申請日時の記載なし";
  if (policy === "grade") {
    const grade =
      metrics.gradeLevel === 0 ? "学年不明" : `メンバーの平均学年 ${Math.round(metrics.gradeLevel * 10) / 10}年`;
    return `${grade}（同じ学年なら${applied}の順）`;
  }
  if (policy === "fewFrames") {
    return `メンバーの最大枠数 ${metrics.maxFrames}枠（同じなら${applied}の順）`;
  }
  if (policy === "narrowWindow") {
    return `日時指定で使える枠 ${metrics.eligibleSlots}枠（同じなら${applied}の順）`;
  }
  if (policy === "singleSlot") {
    return `${metrics.hasSingleSlotMember ? "1枠のみのメンバーあり" : "1枠のみのメンバーなし"}（同じなら${applied}の順）`;
  }
  return applied;
}
