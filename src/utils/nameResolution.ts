import { levenshtein } from "./parseBands";
import type { MemberFrameCount } from "../store/useApplicationStore";

export type NearDuplicatePair = {
  nameA: string;
  nameB: string;
  distance: number;
};

// A 1-2 character edit distance ("鈴木啓大郎" vs "鈴木啓大朗", one kanji
// swapped) is the sweet spot for "probably a typo of the same person" —
// normalizeMemberName already merges width/whitespace variants, so anything
// still showing up as two distinct keys here is either a genuine spelling
// slip or, just as often, two different people whose names happen to be
// similar (siblings, common surnames). That ambiguity is exactly why this
// only *suggests* pairs for a human to confirm via the Name Resolution UI
// rather than merging automatically.
const MAX_NEAR_DUPLICATE_DISTANCE = 2;

/**
 * Scans every pair of distinct (already-normalized) member names for a
 * small edit distance. O(n²) pairwise comparisons — fine at the scale of a
 * single event's participant list (tens to low hundreds of unique names).
 */
export function findNearDuplicateNames(
  frameCounts: Map<string, MemberFrameCount>,
): NearDuplicatePair[] {
  const names = [...frameCounts.keys()];
  const pairs: NearDuplicatePair[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const distance = levenshtein(names[i], names[j]);
      if (distance >= 1 && distance <= MAX_NEAR_DUPLICATE_DISTANCE) {
        pairs.push({ nameA: names[i], nameB: names[j], distance });
      }
    }
  }
  return pairs.sort((a, b) => a.distance - b.distance);
}
