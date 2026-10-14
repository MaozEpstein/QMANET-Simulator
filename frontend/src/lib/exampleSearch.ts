export interface SearchableExample {
  name: string;
  englishName?: string;
  description: string;
  paperRef?: string;
  n: number;
}

// NFKC folds subscripts/superscripts ("K₅" → "K5") so typed queries match
// the typographic names on the cards.
function normalize(s: string): string {
  return s.normalize("NFKC").toLowerCase();
}

/** Every whitespace-separated query term must appear somewhere in the
 * example's text (name, English name, description, paper ref, category
 * title), or match its size as "12" / "n=12". */
export function matchesExampleQuery(
  ex: SearchableExample,
  query: string,
  categoryTitle = "",
): boolean {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = normalize(
    [ex.name, ex.englishName, ex.description, ex.paperRef, categoryTitle].filter(Boolean).join(" "),
  );
  return terms.every((t) => {
    const size = /^n=?(\d+)$/.exec(t);
    if (size) return ex.n === Number(size[1]);
    return hay.includes(t) || (/^\d+$/.test(t) && ex.n === Number(t));
  });
}
