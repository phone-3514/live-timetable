import { stripFrameCountAnnotation } from "./parseBands";

// Two submissions naming the same person can differ in trivial ways that
// don't change who's being referred to — a full-width vs half-width space
// inserted between surname/given name ("鈴木 啓大朗" vs "鈴木啓大朗"), or
// full-width vs half-width alphanumerics. Left as raw strings, those count
// as different people for participation-count/lottery-safety purposes,
// silently under-counting someone's actual number of bands. This is for
// *comparison/grouping only* — never overwrite a stored/displayed name
// with the normalized form, since that would erase how the person actually
// wrote it.
export function normalizeMemberName(name: string): string {
  // A trailing "(3枠目)"-style annotation (see stripFrameCountAnnotation) is
  // stripped before width-folding, in case it's still attached — extraction
  // already strips it going into state (parseBands.ts's extractMemberDetails),
  // but this is the single choke point every frame-count comparison in the
  // app goes through, so it strips it again rather than trusting every
  // caller upstream got it right.
  const withoutFrameNote = stripFrameCountAnnotation(name);
  // A person's own circle/affiliation note — "(Pharman、音研)", "（キアン、
  // うたふ会）" — is also dropped for comparison, the same reasoning as the
  // frame-count case above: the SAME real person's affiliation list often
  // gets written slightly differently across each of their own bands'
  // submissions (different order, half-/full-width comma, a circle's name
  // spelled in Roman letters in one place and katakana in another —
  // "Pharman" vs "ファーマン" — or simply included in one submission and
  // omitted in another), which would otherwise split one real person into
  // several "different" identities purely by how their bandmates happened
  // to phrase the parenthetical that day. extractMemberDetails
  // (parseBands.ts) never puts a paren anywhere but at the very end of a
  // name — annotation always follows the name, never the reverse — so
  // cutting at the FIRST paren (half- or full-width) is a safe,
  // unconditional split, not a keyword-specific one like the frame-count
  // case: everything from there on is annotation, never name content.
  const withoutAffiliationNote = withoutFrameNote.split(/[（(]/)[0];
  // NFKC folds full-width alphanumerics/punctuation (and the full-width
  // "　" ideographic space) down to their half-width equivalents; the
  // explicit \s strip then removes all spacing, half- or full-width alike.
  return withoutAffiliationNote.normalize("NFKC").replace(/\s/g, "");
}
