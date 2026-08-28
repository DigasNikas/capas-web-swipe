# Overview

A crowd-sourced tool for cataloguing Portuguese sports newspaper front pages. Users swipe covers left/right/up/down to classify which football club dominates each edition: Benfica (←), Sporting (→), Porto (↓), Other (↑).

Live at **[capas.digasnikas.com](https://capas.digasnikas.com)**. The logged-in app runs on its own subdomain, **[app.capas.digasnikas.com](https://app.capas.digasnikas.com)**. This page (`/documentation`) is the codebase's manual. `README.md` at the repo root only points here.

## How it works

1. Every morning a **Cloudflare Worker** scrapes the front page of three newspapers (capasjornais.pt, falling back to sapo.pt; see [Scraping](#scraping)) and stores them in **R2** (images) and **D1** (metadata).
2. **`capas.digasnikas.com`** is the public dashboard page. It shows crowd-sourced results (which club each newspaper favours, a calendar of daily winners, the latest classified day) from a dedicated analytics table. No login required.
3. The same three covers are also read by a **vision model** (Workers AI, RAG-augmented, no training) and shown side by side with the crowd's verdict in the dashboard's "Detetor AI" section. See [AI Detector](#ai-detector).
4. Clicking "Entrar" takes you to **`app.capas.digasnikas.com`**, a separate hostname behind **Cloudflare Access**. The Worker reads the `Cf-Access-Authenticated-User-Email` header to identify users and record their swipes.
5. Everything past login lives on that subdomain. "Conta" opens as a bottom-sheet modal over the swipe app, the same pattern as the leaderboard and Instruções modals, with no page navigation. It shows a user's own stats, leaderboard rank, and swipe history. Access is configured as a multi-domain application, so signing in on one host authenticates the other too.

## Infrastructure

| Resource | Provider | Purpose |
|---|---|---|
| Dashboard hosting | Cloudflare Pages (`capas-dashboard`) | Serves `dashboard/` at `capas.digasnikas.com`. Public |
| App hosting | Cloudflare Pages (`capas-app`) | Serves `app/` at `app.capas.digasnikas.com`, behind Access. One page: the swipe app, with account, leaderboard and instructions as modals. |
| Worker | Cloudflare Workers | API + scheduled scraper, routed on both hostnames' `/api/*` |
| Database | Cloudflare D1 (SQLite) | Covers metadata, swipes, match dates, public analytics, comments |
| Image storage | Cloudflare R2 | Full-res covers + generated thumbnails |
| Image processing | Cloudflare Images (Workers binding) | Generates a 220px WebP thumbnail per cover at scrape time (free tier: 5,000 transformations/month) |
| Cover classification | Workers AI (`AI` binding) | Reads each cover and guesses the club it is about. Zero-shot, no training. ~$0.0006/cover |
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
| `thumb_url` | TEXT, nullable | generated 220px WebP thumbnail. `/api/covers` and `/api/stats` fall back to `url` for covers scraped before thumbnails existed; `/api/backfill-thumbs` fills it in. Feeds small on-screen previews (dashboard calendar, catalogue grid); the swipe card and cover modal always use the full-res `url` |
| `ai_club` | TEXT, nullable | model guess, set by the RAG reclassify pass after the scrape (not at scrape time); null until that pass runs, or if the model didn't answer |
| `ai_headline` | TEXT, nullable | the headline the model quoted back while guessing, kept so a wrong label can be diagnosed with one query instead of by opening the image. Null also marks a cover as classified by an older prompt; no automatic re-labelling reads that marker anymore (see [RAG](#rag)'s Quota section for why the old backfill mechanism was removed), it's diagnostic only |
| `ai_why` | TEXT, nullable | the one-line reason the model gave for the club: a name, nickname or kit colour word it leaned on. Same older-prompt marker as `ai_headline` |
| `ai_rag_covers` | TEXT, nullable | JSON array of `covers.id` values: which already-labelled covers the RAG few-shot block was built from for this classification, `"[]"` if none were found. Provenance only, nothing reads it back to build a prompt; see [RAG](#rag) |
| `vectorized_at` | TEXT, nullable | set once this cover is embedded into `capas-cover-embeddings`. The real source of truth for "is this cover in the index," not "does it have a vote"; see [Image Embeddings](#image-embeddings) |
| `created_at` | TEXT | defaults to now |

Unique on `(newspaper, date)`. `ai_club`/`ai_headline`/`ai_why`/`ai_rag_covers`/`vectorized_at` sit on `covers` rather than beside the votes: none of them is a vote and none has a user attached to it. All five were added after the fact, not in `covers`' original `CREATE TABLE`. `ai_club`/`ai_headline`/`ai_why` were applied to the production database by hand, before this project had any migration tooling; `ai_rag_covers` and `vectorized_at` were added through `wrangler d1 migrations` instead (see [Deployment](#deployment)). `schema.sql` carries all five for a fresh database:

```sql
ALTER TABLE covers ADD COLUMN ai_club TEXT;
ALTER TABLE covers ADD COLUMN ai_headline TEXT;
ALTER TABLE covers ADD COLUMN ai_why TEXT;
ALTER TABLE covers ADD COLUMN ai_rag_covers TEXT;
ALTER TABLE covers ADD COLUMN vectorized_at TEXT;
```

### `swipes`

One row per user per cover, upserted on re-swipe.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER, PK | |
| `user_email` | TEXT | from the `Cf-Access-Authenticated-User-Email` header |
| `cover_id` | INTEGER, FK → `covers.id` | |
| `decision` | TEXT | `sporting` / `benfica` / `porto` / `others` |
| `is_favorite` | INTEGER (0/1) | personal bookmark, unrelated to `decision` |
| `swiped_at` | TEXT | defaults to now |

Unique on `(user_email, cover_id)`.

### `matches`

Match dates for Sporting, Benfica and Porto, used to highlight the calendar. See [Match dates](#match-dates).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER, PK | |
| `club` | TEXT | `sporting` / `benfica` / `porto` |
| `match_date` | TEXT | `YYYY-MM-DD` |

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

Never joined with `swipes` or `user_email`. That rule is what keeps the public API private: `/api/stats` reads `analytics_covers` for anything vote-shaped, and joins `covers` only for image URLs and `ai_club`, columns with no user attached to them.

### `comments`

Ephemeral, scoped to a single cover day.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER, PK | |
| `date` | TEXT | the cover day, `YYYY-MM-DD` |
| `author` | TEXT | `"Given - localpart"`, e.g. `Diogo - dlimanic`: first name plus the commenter's email local-part, the same identifier the app's leaderboard shows |
| `author_sub` | TEXT | opaque Google subject id, used only for the daily rate limit (`MAX_PER_DAY`, `COOLDOWN_S` in `comments.js`) and never shown |
| `body` | TEXT | ≤ 240 chars, plain text |
| `created_at` | TEXT | defaults to now |

Reads always filter on the newest date in `analytics_covers`, so a comment stops being reachable the moment tomorrow's covers land; the nightly delete in `index.js` is only housekeeping on top of that. `author` embeds the email's local-part, so a comment is correlatable to an app account, by design.
