# api/

This README is a map, not the manual — the reasoning lives at [capas.digasnikas.com/documentation](https://capas.digasnikas.com/documentation).

The Cloudflare Worker: a single bundle, split by responsibility, deployed by `deploy-worker.yml` on any push touching `api/**` or `wrangler.toml`.

| File | What |
|---|---|
| `index.js` | Router + cron entry point |
| `schema.sql` | D1 database schema |

## `lib/`

| File | What |
|---|---|
| `http.js` | CORS headers + `json()` helper |
| `scraper.js` | Scraping logic (fetch → HTMLRewriter → R2 + D1 → AI) |
| `scraper.test.mjs` | Self-check: the capasjornais.pt URL is built right — `node api/lib/scraper.test.mjs` |
| `ai.js` | Zero-shot cover classification (Workers AI) |
| `ai.test.mjs` | Self-check for the `ANSWER:` parser — `node api/lib/ai.test.mjs` |
| `email.js` | Outbound mail for `/notify` |

## `handlers/`

| File | Route(s) |
|---|---|
| `covers.js` | `GET /covers` |
| `matches.js` | `GET /matches` |
| `stats.js` | `GET /stats` (public — reads `analytics_covers` only, never swipes) |
| `swipes.js` | `GET` + `POST /swipes` (`POST` also refreshes `analytics_covers`) |
| `comments.js` | `GET` + `POST` + `DELETE /comments` (ephemeral, Google sign-in) |
| `leaderboard.js` | `GET /leaderboard` |
| `user-stats.js` | `GET /user-stats?email=` — per-club breakdown + current/best streak, for the leaderboard's row drill-down |
| `scrape.js` | `GET /scrape` (admin, bearer-protected) |
| `notify.js` | `POST /notify` (admin, bearer-protected) |
| `backfill-thumbs.js` | `POST /backfill-thumbs` (admin) |
| `backfill-ai.js` | `POST /backfill-ai` (admin) |
| `*.test.mjs` | Self-checks — plain `node api/handlers/<name>.test.mjs`, no framework |
