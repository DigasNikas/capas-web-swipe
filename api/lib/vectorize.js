// The two Vectorize indexes and what each one needs from D1.
//
// image is cover images (CLIP, 512 dims); headline is the lead headline text
// (multilingual MiniLM, 384 dims). They fill up independently — a cover is
// embeddable as an image the moment it has a crowd vote, but only becomes a
// headline candidate once it also has scraped text, which every past-date
// scrape leaves NULL — so each carries its own progress column rather than
// sharing vectorized_at.
//
// `fields`, `column` and `where` are interpolated straight into SQL, so they
// are literals in this file and never anything a caller sends: the request
// only ever picks a key of this object, and an unknown key is a 400.
export const VECTOR_INDEXES = {
  image: {
    name: "capas-cover-embeddings",
    column: "vectorized_at",
    fields: "c.id, c.newspaper, c.date, c.url, ac.club",
    where: "",
  },
  headline: {
    name: "capas-headline-embeddings",
    column: "headline_vectorized_at",
    fields: "c.id, c.newspaper, c.date, c.headlines, ac.club",
    where: "AND c.headlines IS NOT NULL",
  },
};

// Resolves the ?index= / {index} parameter. Defaults to image so the callers
// that predate the second index (build_vectorize_index.py) keep working
// without passing anything.
export function resolveIndex(value) {
  return VECTOR_INDEXES[value ?? "image"] ?? null;
}
