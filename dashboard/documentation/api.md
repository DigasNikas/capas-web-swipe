# API

The Worker is routed on `/api/*` on **both** hostnames, running the same code against the same D1. Each frontend calls its own same-origin API, so there are no cross-origin credentialed requests and no CORS or cookie handling.

| Method | Path | Host | Auth | Description |
|---|---|---|---|---|
| `GET` | `/api/covers` | `app.` | Access | All covers, ordered by date desc |
| `GET` | `/api/matches` | either | - | All match dates |
| `GET` | `/api/stats` | `capas.` | - | Public aggregate results (per-paper breakdown, per-day winners, latest classified day). Reads only `analytics_covers` |
| `GET` | `/api/swipes` | `app.` | Access | Authenticated user's swipe history |
| `POST` | `/api/swipes` | `app.` | Access | Record a swipe `{ cover_id, decision }`; also refreshes that cover's `analytics_covers` row |
| `POST` | `/api/favorites` | `app.` | Access | Toggle a personal bookmark on an already-swiped cover `{ cover_id, favorite }`. Unrelated to `decision` |
| `GET` | `/api/leaderboard` | `app.` | Access | Swipe count ranked by user |
| `GET` | `/api/user-stats?email=` | `app.` | Access | Per-club vote breakdown plus current/best streak for one user; the leaderboard's row drill-down. Any authenticated app user can look up any other user, the same exposure the leaderboard list already has |
| `GET` | `/api/scrape` | `capas.` | Bearer | Trigger scraper manually. See [Scraping](#scraping) |
| `POST` | `/api/backfill-thumbs` | `capas.` | Bearer | One-off: generates `thumb_url` for 25 covers per call (Workers execution limits rule out doing 1000+ covers in one shot). Returns `{done, remaining}`; call repeatedly until `remaining` is 0 |
| `GET`/`POST`/`DELETE` | `/api/comments` | either | - / Google | Ephemeral comments on the current day's covers; wiped when the covers change |
| `POST` | `/api/notify` | `capas.` | Bearer | Send the daily notification mail |
| `GET` | `/api/rag-candidates?limit=` | `capas.` | Bearer | Up to N covers still missing `ai_club` (id, r2_key, url), newest first, for `scripts/rag_classify.py` to embed. Self-converging: repeated calls work through the backlog rather than reprocessing the same covers. See [RAG](#rag) |
| `POST` | `/api/reclassify-rag` | `capas.` | Bearer | Classify one cover `{coverId, r2Key, fewShot, ragCoverIds}` with an externally-computed RAG few-shot block; the one Llama4 call for that cover. Stores `ragCoverIds` as `ai_rag_covers`, for provenance. See [RAG](#rag) |
| `GET` | `/api/similarities` | `capas.` | - | Every cover with `ai_rag_covers` recorded, plus the covers those ids resolve to. Powers `/similarities`, not restricted to voted covers like `/api/stats` |
| `GET` | `/api/vectorize-candidates?limit=` | `capas.` | Bearer | Up to N voted covers still missing `vectorized_at` (id, newspaper, date, url, club), newest first, for `scripts/build_vectorize_index.py --candidates` to embed. Self-converging like `/rag-candidates`. See [Image Embeddings](#image-embeddings) |
| `POST` | `/api/vectorize-mark` | `capas.` | Bearer | Set `vectorized_at = now` for `{coverIds: [...]}`, after those ids upsert successfully into Vectorize. Never called before the upsert succeeds. See [Image Embeddings](#image-embeddings) |
| `POST` | `/api/backfill-headlines` | `capas.` | Bearer | One-off: fills `headlines` for covers scraped earlier the same day, before that column existed. Today-only. Returns `{done, checked}`. See [Headlines](#headlines) |
| `GET` | `/api/headline-candidates?limit=` | `capas.` | Bearer | Up to N covers still missing `headlines` (id, newspaper, date), oldest first, for `scripts/backfill_headlines_archive.mjs`. Self-converging like `/rag-candidates`. See [Headlines](#headlines) |
| `POST` | `/api/update-headline` | `capas.` | Bearer | Set `headlines` for one cover `{id, headlines}`. See [Headlines](#headlines) |
| `GET` | `/api/search?q=` | `capas.` | - | Full-text search over `headlines` (D1 FTS5), up to 30 results ranked by `bm25()`. Always returns `{results, total, searchable}`; an empty/missing `q` skips the search and just reports coverage. See [Search](#search) |

See [Overview](#overview) for the D1 schema these routes read and write, and `api/README.md` for how the Worker's own files are split.
