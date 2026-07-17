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
  // NFKC folds full-width alphanumerics/punctuation (and the full-width
  // "　" ideographic space) down to their half-width equivalents; the
  // explicit \s strip then removes all spacing, half- or full-width alike.
  return stripFrameCountAnnotation(name).normalize("NFKC").replace(/\s/g, "");
}
