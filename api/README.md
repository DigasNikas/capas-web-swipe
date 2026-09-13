# api/

This README only says where things are. The reasoning lives at [capas.digasnikas.com/documentation](https://capas.digasnikas.com/documentation).

The Cloudflare Worker: a single bundle, split by responsibility, deployed by `deploy-worker.yml` on any push touching `api/**` or `wrangler.toml`.

| File | What |
|---|---|
| `index.js` | Router + cron entry point |
| `schema.sql` | D1 database schema |

## `lib/`

| File | What |
|---|---|
| `http.js` | CORS headers, `json()`, and the shared `requireAdmin()` / `parseLimit()` used by every admin route |
| `vectorize.js` | The two Vectorize indexes and the D1 column/fields each needs, behind the `index=` parameter both vectorize routes take |
| `scraper.js` | Scraping logic (fetch → HTMLRewriter → R2 + D1). Doesn't classify — see `ai.js` and `handlers/reclassify-rag.js` |
| `scraper.test.mjs` | Self-check: the capasjornais.pt cover-image URL and the `headlines` extraction both parse right. Run `node api/lib/scraper.test.mjs` |
| `ai.js` | Cover classification: Llama4 zero-shot, optionally handed a RAG few-shot block computed elsewhere |
| `ai.test.mjs` | Self-check for the `ANSWER:` parser. Run `node api/lib/ai.test.mjs` |
| `email.js` | Outbound mail for `/notify` |
| `access.js` | `accessEmail()`: the app user's email from the Access JWT (`Cf-Access-Jwt-Assertion`), verified against the team's certs. Used by every app-side handler |
| `access.test.mjs` | Self-check: forged header, wrong aud/iss, expired, bad signature. Run `node api/lib/access.test.mjs` |
| `github.js` | Fires `repository_dispatch` events (scrape done, cover's first vote) so GitHub Actions can react |

## `test-utils/`

Node-only helpers for the self-checks. Nothing here is imported by `index.js`.

| File | What |
|---|---|
| `sqlite-d1.mjs` | A D1 binding over `node:sqlite` (Node 22.5+) loaded with `schema.sql`, plus a hook for replaying concurrent requests. Used by the swipes and comments self-checks |

## `handlers/`

| File | Route(s) |
|---|---|
| `covers.js` | `GET /covers` |
| `matches.js` | `GET /matches` |
| `stats.js` | `GET /stats` (public; reads `analytics_covers` only, never swipes) |
| `swipes.js` | `GET` + `POST /swipes` (`POST` also refreshes `analytics_covers`) |
| `comments.js` | `GET` + `POST /comments`, `DELETE /comments/:id` (ephemeral, Google sign-in) |
| `leaderboard.js` | `GET /leaderboard` |
| `user-stats.js` | `GET /user-stats?email=`: per-club breakdown + current/best streak, for the leaderboard's row drill-down |
| `scrape.js` | `POST /scrape` (admin, bearer-protected) |
| `notify.js` | `POST /notify` (admin, bearer-protected) |
| `backfill-thumbs.js` | `POST /backfill-thumbs` (admin) |
| `backfill-headlines.js` | `POST /backfill-headlines` (admin) — today-only: fills `headlines` for covers already scraped earlier today, before this column existed |
| `rag-candidates.js` | `GET /rag-candidates?limit=` (admin) — recent covers for `scripts/rag_classify.py` to embed |
| `reclassify-rag.js` | `POST /reclassify-rag` (admin) — classify one cover with an externally-computed few-shot block |
| `rag-matches.js` | `POST /rag-matches` (admin) — records which covers retrieval matched, without classifying. Retrieval is CLIP + Vectorize, so it runs when the Workers AI allowance is spent |
| `label-consensus.js` | `POST /label-consensus` (admin) — record a label the RAG neighbours agreed on, no model call |
| `similarities.js` | `GET /similarities` (public) — every cover with `ai_rag_covers`, plus what those ids resolve to; powers `dashboard/similarities.html` |
| `vectorize-candidates.js` | `GET /vectorize-candidates?limit=` (admin) — voted covers still missing `vectorized_at`, for `scripts/build_vectorize_index.py --candidates` to embed |
| `vectorize-mark.js` | `POST /vectorize-mark` (admin) — sets `vectorized_at` for a batch of cover ids that just upserted into Vectorize |
| `headline-candidates.js` | `GET /headline-candidates?limit=` (admin) — covers still missing `headlines`, oldest first, for `scripts/backfill_headlines_archive.mjs` |
| `update-headline.js` | `POST /update-headline` (admin) — sets `headlines` for one cover id |
| `headlines.js` | `GET /headlines` (public) — every cover's scraped front-page text, for `scripts/rag_classify.py --eval` |
| `search.js` | `GET /search?q=` (public) — D1 FTS5 search over `headlines`, powers `dashboard/search.html` |
| `*.test.mjs` | Self-checks: plain `node api/handlers/<name>.test.mjs`, no framework |
