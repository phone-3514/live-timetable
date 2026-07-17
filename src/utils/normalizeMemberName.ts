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
  // NFKC folds full-width alphanumerics/punctuation (and the full-width
  // "　" ideographic space) down to their half-width equivalents; the
  // explicit \s strip then removes all spacing, half- or full-width alike.
  return name.normalize("NFKC").replace(/\s/g, "");
}
