# Search

`search.html` (`capas.digasnikas.com/search.html`) is a text box over
`covers.headlines` — type a word or two, get back the covers whose real
scraped headline text matches, shown as a grid of clickable cover
thumbnails. Public, no login, same audience as [Similarities](#rag).

## Viewing a result: the cover modal

Clicking a result thumbnail opens it enlarged in a modal — no new tab,
no page navigation. If that cover has RAG few-shot matches recorded
(`ai_rag_covers`, up to `RAG_TOP_K` = 5), the modal also shows a
"Parecidas" strip of their thumbnails underneath, resolved from
`/api/similarities`. Fetched once on page load and cached client-side,
not re-fetched per modal open, since it's the same public dataset
[Similarities](#rag) already exposes. A cover with no RAG matches — not
yet classified, or classified with no similar covers found — just shows
no strip; nothing in the modal implies a failure.

## Drilling into a "parecida"

Clicking one of the strip's thumbnails opens a second modal, a
carousel over that cover's up-to-5 RAG matches, positioned as a smaller
panel floating on top of the first — not a replacement for it. The
original cover stays exactly where it was, dimmed behind a light
scrim, so drilling into a similar cover reads as looking closer, not as
navigating away. `‹`/`›` (mouse) and the Left/Right arrow keys (only
while this second modal is open) page through the same 5 covers;
`Escape` closes whichever modal is currently on top, so backing out of
the carousel takes two presses — one back to the original cover, one
back to the results grid — rather than jumping straight past it.

## Why D1 FTS5, not Vectorize

The first design for this used semantic search: embed each cover's
`headlines` text, store the vectors in Vectorize, embed the typed query
the same way, ask for nearest neighbours — the same shape as
[Image Embeddings](#image-embeddings). Two things ruled it out for now:

- Bulk-embedding ~1800 headlines through Workers AI competes for the same
  account-wide 10,000-neuron daily allowance `rag-classify.yml` already
  runs into (see [RAG](#rag)'s Quota section) — exactly the failure mode
  that broke the AI Detector on 2026-08-31. Running it outside the Worker
  instead (mirroring `build_vectorize_index.py`'s local CLIP) sidesteps
  the bulk cost, but a live typed query still has to be embedded
  synchronously inside the request, and only Workers AI can do that — so
  the live path can't fully escape the quota either way.
- It's more machinery than the actual requirement calls for: "find
  covers whose headline mentions X" is keyword matching, not meaning
  matching. SQLite's own full-text index does that natively, with no
  embedding step anywhere, no Vectorize index, no Workers AI call, live
  or offline.

If genuine semantic search — a query that matches a headline without
sharing any words with it — turns out to matter later, that's a separate
feature built on top of this one, not a replacement for it.

## The index

`covers_fts` (`migrations/0004_add_headlines_fts.sql`) is an
external-content FTS5 virtual table: the headline text lives once, on
`covers.headlines` itself, and `covers_fts` only holds the inverted
index, keyed on `covers.id` as its rowid (`content='covers',
content_rowid='id'`). Kept in sync by three triggers on `covers`
(`AFTER INSERT`/`UPDATE`/`DELETE`) rather than duplicated by hand
anywhere — `scrapeNewspaper`'s insert, `/update-headline`'s and
`/backfill-headlines`'s updates, and `scripts/backfill_headlines_archive.mjs`
all go through the same `covers` table, so all of them stay searchable
automatically. A cover with `headlines IS NULL` still gets an FTS row,
just one indexing nothing — harmless, matches nothing.

## `/api/search`

`GET /api/search?q=` (public, `capas.` host, no auth). Splits `q` on
whitespace, quotes each term (`"word"`), and joins them — this both
neutralizes FTS5's own special syntax characters (`*`, `-`, `:`, `(`,
`)`, a quote) that a typed sentence could otherwise trip over, and makes
space-separated terms AND together, capped at 12 terms. `buildFtsQuery`
in `api/handlers/search.js` is the pure function that does this, tested
directly in `search.test.mjs` without needing D1 at all.

Results are ranked by SQLite's `bm25()` over `covers_fts`, joined back to
`covers` for the fields the UI needs (thumbnail, newspaper, date, the
headline itself), capped at 30. The response always carries
`{results, total, searchable}`, even for an empty `q` — that's how the
page shows its coverage line without a second request: `search('')` on
load runs the coverage `COUNT` but skips the `MATCH` query entirely (an
empty FTS5 `MATCH ''` is invalid syntax, not just zero results).

## Coverage

`searchable` is `covers` where `headlines IS NOT NULL` — see
[Headlines](#headlines) for why that's short of `total`: the live scrape
only ever sets it going forward, and the historical archive backfill
didn't reach every past cover. `search.html` shows this as "Procura em
mais de X capas," X rounded down to the nearest hundred — a plain
statement of scale, not a breakdown of what's missing or why.
