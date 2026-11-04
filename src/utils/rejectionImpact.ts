import type { Application } from "../types";
import { normalizeMemberName } from "./normalizeMemberName";
import { stripAffiliationNoteForDisplay } from "./parseBands";

// 却下による枠数の変動: how rejecting bands changed each member's number of
// bands. "枠数" here is the count of bands a person is in (the same count as the
// メンバー別出演枠数 list): `now` counts the applications still on the list,
// `before` adds back the rejected ones they were in.

export type MemberImpact = {
  key: string;
  name: string;
  before: number;
  now: number;
  /** Rejected bands this person was in. */
  rejectedBands: string[];
};

export function computeMemberImpacts(
  applications: Application[],
  rejected: Application[],
): Map<string, MemberImpact> {
  const now = new Map<string, number>();
  for (const app of applications) {
    for (const key of new Set(app.members.map((m) => normalizeMemberName(m.name)).filter(Boolean))) {
      now.set(key, (now.get(key) ?? 0) + 1);
    }
  }
  const impacts = new Map<string, MemberImpact>();
  for (const app of rejected) {
    const seen = new Set<string>();
    for (const member of app.members) {
      const key = normalizeMemberName(member.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const entry = impacts.get(key) ?? {
        key,
        name: stripAffiliationNoteForDisplay(member.name),
        before: now.get(key) ?? 0,
        now: now.get(key) ?? 0,
        rejectedBands: [],
      };
      entry.before += 1;
      entry.rejectedBands.push(app.bandName);
      impacts.set(key, entry);
    }
  }
  return impacts;
}

/** "田中: 3枠→2枠" / "佐藤: 1枠→0枠（出演枠なし）" for one rejected band's members. */
export function describeBandImpact(app: Application, impacts: Map<string, MemberImpact>): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const member of app.members) {
    const key = normalizeMemberName(member.name);
    const impact = key ? impacts.get(key) : undefined;
    if (!impact || seen.has(key)) continue;
    seen.add(key);
    lines.push(
      `${impact.name}: ${impact.before}枠→${impact.now}枠${impact.now === 0 ? "（出演枠なし）" : ""}${
        impact.rejectedBands.length > 1 ? `（他の却下バンドの分も含む）` : ""
      }`,
    );
  }
  return lines;
}
