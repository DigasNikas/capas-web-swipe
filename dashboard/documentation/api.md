# API

The Worker is routed on `/api/*` on **both** hostnames — same code, same D1, so each frontend calls its own same-origin API (no cross-origin credentialed requests, no CORS/cookie complexity).

| Method | Path | Host | Auth | Description |
|---|---|---|---|---|
| `GET` | `/api/covers` | `app.` | Access | All covers, ordered by date desc |
| `GET` | `/api/matches` | either | — | All match dates |
| `GET` | `/api/stats` | `capas.` | — | Public aggregate results (per-paper breakdown, per-day winners, latest classified day) — reads only `analytics_covers` |
| `GET` | `/api/swipes` | `app.` | Access | Authenticated user's swipe history |
| `POST` | `/api/swipes` | `app.` | Access | Record a swipe `{ cover_id, decision }`; also refreshes that cover's `analytics_covers` row |
| `POST` | `/api/favorites` | `app.` | Access | Toggle a personal bookmark on an already-swiped cover `{ cover_id, favorite }` — unrelated to `decision` |
| `GET` | `/api/leaderboard` | `app.` | Access | Swipe count ranked by user |
| `GET` | `/api/user-stats?email=` | `app.` | Access | Per-club vote breakdown + current/best streak for one user — the leaderboard's row drill-down. Any authenticated app user can look up any other user, same exposure the leaderboard list already has |
| `GET` | `/api/scrape` | `capas.` | Bearer | Trigger scraper manually — see [Scraping](#scraping) |
| `POST` | `/api/backfill-thumbs` | `capas.` | Bearer | One-off: generates `thumb_url` for 25 covers per call (Workers execution limits rule out doing this in one shot for 1000+ covers) — returns `{done, remaining}`, call repeatedly until `remaining` is 0 |
| `POST` | `/api/backfill-ai` | `capas.` | Bearer | Classifies 8 covers per call, newest first — returns `{done, attempted, remaining}`, call repeatedly. Also re-labels covers left by an older prompt (no `ai_headline`). Batch is smaller than the thumbnail one because each cover is a multi-second model call |
| `GET`/`POST`/`DELETE` | `/api/comments` | either | — / Google | Ephemeral comments on the current day's covers; wiped when the covers change |
| `POST` | `/api/notify` | `capas.` | Bearer | Send the daily notification mail |

See [Overview](#overview) for the D1 schema these routes read and write, and `api/README.md` for how the Worker's own files are split.
