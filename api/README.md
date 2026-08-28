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
| `http.js` | CORS headers + `json()` helper |
| `scraper.js` | Scraping logic (fetch → HTMLRewriter → R2 + D1). Doesn't classify — see `ai.js` and `handlers/reclassify-rag.js` |
| `scraper.test.mjs` | Self-check: the capasjornais.pt URL is built right. Run `node api/lib/scraper.test.mjs` |
| `ai.js` | Cover classification: Llama4 zero-shot, optionally handed a RAG few-shot block computed elsewhere |
| `ai.test.mjs` | Self-check for the `ANSWER:` parser. Run `node api/lib/ai.test.mjs` |
| `email.js` | Outbound mail for `/notify` |
| `github.js` | Fires `repository_dispatch` events (scrape done, cover's first vote) so GitHub Actions can react |

## `handlers/`

| File | Route(s) |
|---|---|
| `covers.js` | `GET /covers` |
| `matches.js` | `GET /matches` |
| `stats.js` | `GET /stats` (public; reads `analytics_covers` only, never swipes) |
| `swipes.js` | `GET` + `POST /swipes` (`POST` also refreshes `analytics_covers`) |
| `comments.js` | `GET` + `POST` + `DELETE /comments` (ephemeral, Google sign-in) |
| `leaderboard.js` | `GET /leaderboard` |
| `user-stats.js` | `GET /user-stats?email=`: per-club breakdown + current/best streak, for the leaderboard's row drill-down |
| `scrape.js` | `GET /scrape` (admin, bearer-protected) |
| `notify.js` | `POST /notify` (admin, bearer-protected) |
| `backfill-thumbs.js` | `POST /backfill-thumbs` (admin) |
| `rag-candidates.js` | `GET /rag-candidates?limit=` (admin) — recent covers for `scripts/rag_classify.py` to embed |
| `reclassify-rag.js` | `POST /reclassify-rag` (admin) — classify one cover with an externally-computed few-shot block |
| `similarities.js` | `GET /similarities` (public) — every cover with `ai_rag_covers`, plus what those ids resolve to; powers `dashboard/similarities.html` |
| `vectorize-candidates.js` | `GET /vectorize-candidates?limit=` (admin) — voted covers still missing `vectorized_at`, for `scripts/build_vectorize_index.py --candidates` to embed |
| `vectorize-mark.js` | `POST /vectorize-mark` (admin) — sets `vectorized_at` for a batch of cover ids that just upserted into Vectorize |
| `*.test.mjs` | Self-checks: plain `node api/handlers/<name>.test.mjs`, no framework |
