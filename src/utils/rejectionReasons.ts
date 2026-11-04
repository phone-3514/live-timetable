import type { PlannerBand, RejectionExplanation } from "./rejectionPlanner";
import type { BandMetrics, RejectionPolicy } from "./rejectionPolicy";

// Why a band is on the 却下の目安 list, in the words the organizer would use to
// tell someone: the one-line reason (which follows the 基準 chosen — 枠数が多い,
// 演奏可能な時間が短い, …), how many bands it is competing with for the slots it
// could use, and what made those bands the ones kept.

export type RejectionCompetitor = {
  name: string;
  rank: number;
  /** The fact this band was ranked on (see describePriorityBasis). */
  basis: string;
  /** Sits in a slot this band could have taken outright. */
  direct: boolean;
};

export type RejectionReason = {
  /** Short label used to group the list ("枠数が多い", "演奏可能な時間が短い"…). */
  category: string;
  headline: string;
  competitorCount: number;
  directCount: number;
  competitors: RejectionCompetitor[];
};

const round1 = (n: number) => Math.round(n * 10) / 10;

function averageOf(values: (number | undefined)[]): number | null {
  const nums = values.filter((v): v is number => v !== undefined);
  return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function describeRejectionReason(
  policy: RejectionPolicy,
  band: PlannerBand & { metrics?: BandMetrics },
  explanation: RejectionExplanation,
): RejectionReason {
  const blockers = explanation.blockers as { band: PlannerBand & { metrics?: BandMetrics }; rank: number; direct: boolean }[];
  const competitors: RejectionCompetitor[] = [...blockers]
    .sort((a, b) => Number(b.direct) - Number(a.direct) || b.rank - a.rank)
    .map((b) => ({ name: b.band.name, rank: b.rank, basis: b.band.note ?? "", direct: b.direct }));
  const directCount = blockers.filter((b) => b.direct).length;
  const base = { competitorCount: blockers.length, directCount, competitors };

  if (explanation.eligibleSlots.length === 0) {
    return {
      ...base,
      category: "日時指定に合う枠がない",
      headline:
        "日時指定に合う枠が1つもないため（書かれている日付や時間帯が、各日の枠と重なっていません）",
    };
  }
  if (explanation.freeSlotReachable) {
    return {
      ...base,
      category: "必要な枠をまとめて取れない",
      headline: `${band.units}枠分が必要で、日時指定に合う枠の中で必要な枠数をまとめて確保できなかったため`,
    };
  }

  const m = band.metrics;
  const others = blockers.map((b) => b.band.metrics);
  const tail = `（日時指定の合う枠を使っている${blockers.length}組のほうが優先されました）`;
  switch (policy) {
    case "grade": {
      const own = m ? round1(m.gradeLevel) : null;
      const avg = averageOf(others.map((o) => o?.gradeLevel));
      return {
        ...base,
        category: "平均学年が低い",
        headline: `平均学年が低いため（このバンド ${own ? `${own}年` : "学年不明"}／競合の平均 ${avg ? `${round1(avg)}年` : "不明"}）${tail}`,
      };
    }
    case "fewFrames": {
      const avg = averageOf(others.map((o) => o?.maxFrames));
      return {
        ...base,
        category: "枠数が多い",
        headline: `枠数が多いため（このバンドは最大${m ? round1(m.maxFrames) : "?"}枠目／競合の平均は最大${avg ? round1(avg) : "?"}枠目）${tail}`,
      };
    }
    case "singleSlot": {
      const withSingle = others.filter((o) => o?.hasSingleSlotMember).length;
      return {
        ...base,
        category: "1枠のみのメンバーがいない",
        headline: `1枠のみのメンバーがいないため（競合${blockers.length}組のうち${withSingle}組には1枠のみのメンバーがいます）${tail}`,
      };
    }
    case "singleSlotThenFrames": {
      if (m?.hasSingleSlotMember) {
        return {
          ...base,
          category: "1枠のみの人がいるが枠が足りない",
          headline: `1枠のみのメンバーがいるため最優先にしましたが、使える枠が、同じく優先されるバンドなどで埋まっているため${tail}`,
        };
      }
      const avg = averageOf(others.map((o) => o?.maxFrames));
      const protectedCount = others.filter((o) => o?.hasSingleSlotMember).length;
      return {
        ...base,
        category: "1枠のみの人がいない・枠数が多い",
        headline: `1枠のみのメンバーがいなくて枠数が多いため（このバンドは最大${m ? round1(m.maxFrames) : "?"}枠目／競合${blockers.length}組は平均で最大${avg ? round1(avg) : "?"}枠目、うち${protectedCount}組は1枠のみのメンバーがいて優先）${tail}`,
      };
    }
    case "narrowWindow": {
      const avg = averageOf(others.map((o) => o?.eligibleSlots));
      return {
        ...base,
        category: "演奏可能な時間が短い",
        headline: `演奏可能な時間が短いため（使える枠 ${m ? m.eligibleSlots : "?"}枠／競合は平均 ${avg ? round1(avg) : "?"}枠）${tail}`,
      };
    }
    default:
      return {
        ...base,
        category: "申請が遅い",
        headline: `申請が遅いため（${explanation.rank}番目。先に申請した${blockers.length}組で、使える枠が埋まっています）`,
      };
  }
}

/** Plain text for pasting into LINE etc. */
export function formatRejectionListText(
  policyLabel: string,
  items: { band: PlannerBand; reason: RejectionReason }[],
): string {
  const lines = [`却下の目安（${items.length}組）— 基準：${policyLabel}`, ""];
  for (const { band, reason } of items) {
    lines.push(`■ ${band.name}`);
    lines.push(`  日時指定：${band.specLabel}`);
    lines.push(`  理由：${reason.headline}`);
    if (reason.competitors.length > 0) {
      lines.push(`  競合（${reason.competitorCount}組）：`);
      for (const c of reason.competitors.slice(0, 8)) {
        lines.push(`    - ${c.name}（${c.rank}番目${c.basis ? `／${c.basis}` : ""}）`);
      }
      if (reason.competitors.length > 8) lines.push(`    …ほか${reason.competitors.length - 8}組`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
