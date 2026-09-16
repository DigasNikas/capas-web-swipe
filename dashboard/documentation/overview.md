# Overview

A crowd-sourced tool for cataloguing Portuguese sports newspaper front pages. Users swipe covers left/right/up/down to classify which football club dominates each edition: Benfica (←), Sporting (→), Porto (↓), Other (↑).

Live at **[capas.digasnikas.com](https://capas.digasnikas.com)**. The logged-in app runs on its own subdomain, **[app.capas.digasnikas.com](https://app.capas.digasnikas.com)**. This page (`/documentation`) is the codebase's manual. `README.md` at the repo root only points here.

## How it works

1. A **Worker cron** scrapes three newspapers' front pages into **R2** (images) and **D1** (metadata), idempotently, six times a day ([Scraping](#scraping)).
2. **capas.digasnikas.com** is the public dashboard: which club each newspaper favours, a calendar of daily winners, the latest day's verdict. No login.
3. **app.capas.digasnikas.com** is the swipe app, behind **Cloudflare Access**. The Worker identifies users from the Access JWT it verifies itself (`accessEmail`, `api/lib/access.js`), not from a header it trusts. Account, leaderboard and instructions are modals over the app, not pages. Access is a multi-domain application, so one sign-in covers both hosts.
4. A cover's **first vote** puts it into the two Vectorize indexes and makes it classifiable. A **vision model** then reads it and the dashboard shows that verdict beside the crowd's ([AI Detector](#ai-detector)).

## Infrastructure

| Resource | Provider | Purpose |
|---|---|---|
| Dashboard hosting | Cloudflare Pages (`capas-dashboard`) | Serves `dashboard/` at `capas.digasnikas.com`. Public |
| App hosting | Cloudflare Pages (`capas-app`) | Serves `app/` at `app.capas.digasnikas.com`, behind Access. One page: the swipe app, with account, leaderboard and instructions as modals. |
| Worker | Cloudflare Workers | API + scheduled scraper, routed on both hostnames' `/api/*` |
| Database | Cloudflare D1 (SQLite) | Covers metadata, swipes, match dates, public analytics, comments |
| Image storage | Cloudflare R2 | Full-res covers + generated thumbnails |
| Image processing | Cloudflare Images (Workers binding) | Generates a 220px WebP thumbnail per cover at scrape time (free tier: 5,000 transformations/month) |
| Cover classification | Workers AI (`AI` binding) | Llama 4 Scout reads each cover and names the club. Zero-shot, ~65 neurons per call |
| Retrieval | Cloudflare Vectorize | Two indexes, cover images and lead headlines, for the classifier's few-shot context and the `others` gate |
| Auth | Cloudflare Access | Gates the entire `app.capas.digasnikas.com`: pages plus `/api/covers`, `/api/swipes`, `/api/leaderboard`. `capas.digasnikas.com` (dashboard, `/api/stats`, `/api/matches`) is fully public. |

Both Pages projects git-connect to this repo/branch and deploy on every push. One commit produces two independent deploys, one per project, each with its own `destination_dir` (`dashboard` vs `app`). See [Deployment](#deployment).

## D1 schema

### `covers`

One row per newspaper per day.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER, PK | |
| `newspaper` | TEXT | `record` / `abola` / `ojogo` |
| `date` | TEXT | `YYYY-MM-DD` |
| `r2_key` | TEXT | R2 object key, e.g. `2026/04/25/record_2026-04-25.jpg` |
| `url` | TEXT | full-res public URL |
| `thumb_url` | TEXT, nullable | Generated 220px WebP thumbnail, for on-screen previews; the swipe card and cover modal use the full-res `url`. `/api/covers` and `/api/stats` fall back to `url` for covers scraped before thumbnails existed, and `/api/backfill-thumbs` fills it in |
| `headlines` | TEXT, nullable | The page's own title text, scraped from capasjornais.pt ([Headlines](#headlines)) |
| `ai_club` | TEXT, nullable | The model's answer, or a consensus label. `NULL` means never classified |
| `ai_source` | TEXT, nullable | `model` or `consensus` |
| `ai_owns` | TEXT, nullable | `yes` / `no`: the model's answer to whether one club owns the page |
| `ai_headline` | TEXT, nullable | The headline the model quoted; `""` on a consensus row |
| `ai_why` | TEXT, nullable | The model's one-line reason, or the consensus margin |
| `ai_rag_covers` | TEXT, nullable | JSON array of neighbour `covers.id` values the few-shot block was built from. Provenance only ([RAG](#rag)) |
| `ai_rag_source` | TEXT, nullable | JSON array of `headline`/`layout`, same order: which channel found each neighbour |
| `lr_benfica`, `lr_porto`, `lr_sporting`, `lr_others` | REAL, nullable | The `others` gate's probabilities ([AI Detector](#ai-detector)) |
| `lr_asof` | TEXT, nullable | Which fit produced them |
| `vectorized_at` | TEXT, nullable | Set once the cover is in `capas-cover-embeddings` ([Image Embeddings](#image-embeddings)) |
| `headline_vectorized_at` | TEXT, nullable | The same for `capas-headline-embeddings`. Separate because that index also needs `headlines` ([Headline Embeddings](#headline-embeddings)) |
| `created_at` | TEXT | defaults to now |

Unique on `(newspaper, date)`. Everything after `thumb_url` was added later, by `ALTER TABLE`; `api/schema.sql` carries them all for a fresh database, and `migrations/` has one file per change since the project gained migration tooling ([Deployment](#deployment)). None of these columns is a vote and none has a user attached.

Nothing revisits a cover once `ai_club` is set: re-classifying means clearing the `ai_*` columns first.

### `users` (view)

`email`, `first_swipe_at`, `last_swipe_at`, `swipe_count`, grouped from `swipes`. Not a table.

### `swipes`

One row per user per cover, upserted on re-swipe.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER, PK | |
| `user_email` | TEXT | The `email` claim of the verified Access JWT ([Deployment](#deployment)) |
| `cover_id` | INTEGER, FK → `covers.id` | |
| `decision` | TEXT | `sporting` / `benfica` / `porto` / `others`, enforced by a CHECK |
| `is_favorite` | INTEGER (0/1) | personal bookmark, unrelated to `decision` |
| `swiped_at` | TEXT | defaults to now |

Unique on `(user_email, cover_id)`, indexed on `cover_id` for the per-vote analytics recompute.

### `matches`

Match dates for Sporting, Benfica and Porto, used to highlight the calendar. See [Match dates](#match-dates).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER, PK | |
| `club` | TEXT | `sporting` / `benfica` / `porto` |
| `match_date` | TEXT | `YYYY-MM-DD` |
| `competition` | TEXT, nullable | `PPL`, `CL`, `EL`, `UECL`, `TP`, `TL` |

Unique on `(club, match_date)`.

### `analytics_covers`

One row per cover with ≥1 vote, holding the winning club and vote counts, refreshed on every swipe.

| Column | Type | Notes |
|---|---|---|
| `cover_id` | INTEGER, PK, FK → `covers.id` | |
| `newspaper` | TEXT | |
| `date` | TEXT | |
| `club` | TEXT | winning decision for this cover |
| `votes_club` | INTEGER | votes for the winning club |
| `votes_total` | INTEGER | |
| `updated_at` | TEXT | defaults to now |

Never joined with `swipes` or `user_email`. That rule is what keeps the public API private: `/api/stats` and `/api/detector` read `analytics_covers` for anything vote-shaped and join `covers` only for columns with no user attached. It is also why an unvoted cover is invisible on the dashboard, and why classification waits for a vote ([AI Detector](#ai-detector)).

### `comments`

Ephemeral, scoped to a single cover day.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER, PK | |
| `date` | TEXT | the cover day, `YYYY-MM-DD` |
| `author` | TEXT | `"Given - localpart"`, e.g. `Ana - ana92`: first name plus the commenter's email local-part, the same identifier the app's leaderboard shows |
| `author_sub` | TEXT | opaque Google subject id, used only for the daily rate limit (`MAX_PER_DAY`, `COOLDOWN_S` in `comments.js`) and never shown |
| `body` | TEXT | ≤ 240 chars, plain text |
| `created_at` | TEXT | defaults to now |

Reads always filter on the newest date in `analytics_covers`, so a comment stops being reachable the moment tomorrow's covers land; the nightly delete in `index.js` is only housekeeping on top of that. `author` embeds the email's local-part, so a comment is correlatable to an app account, by design.
