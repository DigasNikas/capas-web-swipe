# Avaliador de Capas Desportivas ⚽

A crowd-sourced tool for cataloguing Portuguese sports newspaper front pages. Users swipe covers left/right/up/down to classify which football club dominates each edition — Benfica (←), Sporting (→), Porto (↓), or Other (↑).

Live at **[capas.digasnikas.com](https://capas.digasnikas.com)**
(the logged-in app lives on its own subdomain: **[app.capas.digasnikas.com](https://app.capas.digasnikas.com)**)

---

## How It Works

1. Every morning a **Cloudflare Worker** scrapes the front page of three newspapers from sapo.pt and stores them in **R2** (images) and **D1** (metadata).
2. **`capas.digasnikas.com`** is the public landing page — it shows crowd-sourced results (which club each newspaper favours, a calendar of daily winners, the latest classified day) from a dedicated analytics table, no login required.
3. The same three covers are also read by a **vision model** (Workers AI, zero-shot — no training) and shown side by side with the crowd's verdict in the landing page's "Detetor AI" section.
4. Clicking "Entrar" takes you to **`app.capas.digasnikas.com`**, a separate hostname behind **Cloudflare Access** — the Worker reads the `Cf-Access-Authenticated-User-Email` header to identify users and record their swipes.
5. Everything past login lives on that subdomain. "Conta" opens as a bottom-sheet modal over the swipe app (same pattern as the leaderboard and Instruções modals — no page navigation), showing a user's own stats, leaderboard rank, and swipe history. Access is configured as a multi-domain application, so signing in on one host authenticates the other too.

---

## Project Structure

Two Cloudflare Pages projects deploy from this same repo/branch, each
pointed at a different `destination_dir` — that's what makes `landing/`
and `app/` self-contained (each holds its own `index.html`, not just its
JS):

```
capas-web-swipe/
├── landing/               Pages project "capas-landing" → capas.digasnikas.com
│   ├── index.html         Public landing page (results, no login)
│   ├── landing.js         Fetches /api/stats + /api/matches, renders it
│   └── landing.css        Landing page styles (separate visual language from the app)
│
├── app/                   Pages project "capas-app" → app.capas.digasnikas.com (behind Access)
│   ├── index.html         Swipe app
│   ├── app.js             Swipe app entry (ES module): event listeners + init()
│   ├── style.css          All app styles (one page, one stylesheet)
│   └── src/                Frontend ES modules used by app.js
│       ├── state.js        Shared mutable state + all constants (ACTIONS, API_URL, …)
│       ├── dom.js           DOM element references (app page)
│       ├── dates.js        Date/time formatting and grouping helpers
│       ├── calendar.js     Calendar rendering, month navigation, date-click handler
│       ├── ui.js            Progress bar, date header, empty state updates
│       ├── cards.js        Card stack, swipe gestures, commit logic, group navigation
│       ├── catalogue.js    Histórico rendering (drill-down, filters, image grid)
│       ├── leaderboard.js  Leaderboard modal (fetch + render)
│       ├── account.js      Conta modal (stats, rank, Histórico) — reuses catalogue.js
│       └── modals.js       animateModalClose, swipe-down-to-close, instrucoes modal
│
├── wrangler.toml         Cloudflare Worker configuration
├── package.json          Wrangler dev dependency
│
├── api/                  Cloudflare Worker (single bundle, split by responsibility)
│   ├── index.js          Router + cron entry point
│   ├── schema.sql        D1 database schema
│   ├── lib/
│   │   ├── http.js       CORS headers + json() helper
│   │   ├── scraper.js    Scraping logic (fetch → HTMLRewriter → R2 + D1 → AI)
│   │   ├── ai.js         Zero-shot cover classification (Workers AI) — see "AI Detector"
│   │   └── email.js      Outbound mail for /notify
│   └── handlers/
│       ├── covers.js     GET  /covers
│       ├── matches.js    GET  /matches
│       ├── stats.js      GET  /stats  (public — reads analytics_covers only, never swipes)
│       ├── swipes.js     GET  + POST /swipes (POST also refreshes analytics_covers)
│       ├── comments.js   GET + POST + DELETE /comments (ephemeral, Google sign-in)
│       ├── leaderboard.js GET /leaderboard
│       ├── scrape.js     GET  /scrape  (admin, bearer-protected)
│       ├── notify.js     POST /notify  (admin, bearer-protected)
│       ├── backfill-thumbs.js  POST /backfill-thumbs (admin)
│       ├── backfill-ai.js      POST /backfill-ai     (admin)
│       └── *.test.mjs    Self-checks — plain `node api/handlers/<name>.test.mjs`, no framework
│
├── scripts/              Local tooling (not deployed)
│   ├── scrape_month.sh   Trigger the /scrape API for a full calendar month
│   └── import_matches.py Import match dates into D1 (football-data.org + api-sports.io)
│
└── images/               Newspaper logos (static assets for the frontend)
    ├── abola.png
    ├── ojogo.png
    ├── record.png
    └── manifest.json
```

The frontend uses native ES modules (`<script type="module">`) — no build step required. `src/` and `style.css` live inside `app/` because only `app.js` uses them — `landing/` never touches either. Every reference across files (`/src/state.js`, `/style.css`) uses an absolute path rather than a relative one. Modules share state via the `state` object exported from `src/state.js`, which is passed by reference across all imports — `account.js` reads `state.images`/`state.catalogue` directly rather than refetching `/api/covers`+`/api/swipes` itself, since `app.js`'s `init()` already loaded them before any modal can be opened.

Cross-host links (landing's "Entrar", app's "Início") are absolute URLs, since `landing/` and `app/` are two different hostnames now, not two paths on one host. The Access logout link (inside the Conta modal) stays relative.

> **Note:** ES modules require a server context. Pages can't be opened via `file://` — use `wrangler dev` or any local HTTP server for local testing.

---

## Infrastructure

| Resource | Provider | Purpose |
|---|---|---|
| Landing hosting | Cloudflare Pages (`capas-landing`) | Serves `landing/` at `capas.digasnikas.com` — public |
| App hosting | Cloudflare Pages (`capas-app`) | Serves `app/` at `app.capas.digasnikas.com` — behind Access. One page — the swipe app, account/leaderboard/instructions all as modals. |
| Worker | Cloudflare Workers | API + scheduled scraper, routed on both hostnames' `/api/*` |
| Database | Cloudflare D1 (SQLite) | Covers metadata, swipes, match dates, public analytics |
| Image storage | Cloudflare R2 | Full-res covers + generated thumbnails |
| Image processing | Cloudflare Images (Workers binding) | Generates a 220px WebP thumbnail per cover at scrape time (free tier: 5,000 transformations/month) |
| Cover classification | Workers AI (`AI` binding) | Reads each cover and guesses the club it is about — zero-shot, no training. ~$0.0006/cover |
| Auth | Cloudflare Access | Gates the entire `app.capas.digasnikas.com` — pages and its `/api/covers`, `/api/swipes`, `/api/leaderboard`. `capas.digasnikas.com` (landing, `/api/stats`, `/api/matches`) is fully public. |

Both Pages projects git-connect to this repo/branch and deploy on every
push — same push, same commit, two independent deploys (different
`destination_dir` per project: `landing` vs `app`).

### D1 Schema

**`covers`** — one row per newspaper per day. `url` is the full-res image; `thumb_url` is a generated 220px WebP thumbnail (nullable — falls back to `url` in `/api/covers` and `/api/stats` for covers scraped before thumbnails existed; backfill with `/api/backfill-thumbs`). Thumbnails feed small on-screen previews (landing calendar, catalogue grid); the swipe card and cover modal always use the full-res `url`.  
`ai_club` is the model's own guess for that cover (nullable — absent until classified; backfill with `/api/backfill-ai`). It sits on `covers` rather than beside the votes because it is not a vote and has no user attached to it.  
**`swipes`** — one row per user per cover (upserted on re-swipe)  
**`matches`** — match dates for Sporting, Benfica, Porto (used to highlight the calendar)  
**`analytics_covers`** — one row per cover with ≥1 vote: the winning club + vote counts, refreshed on every swipe. Never joined with `swipes`/`user_email`, which is the rule that keeps the public API private: `/api/stats` reads `analytics_covers` for anything vote-shaped, joining `covers` only for image URLs and `ai_club` — columns with no user attached to them.

`ai_club` was added after the fact. An existing database needs it applied by hand; `schema.sql` already has it for a fresh one:

```sql
ALTER TABLE covers ADD COLUMN ai_club TEXT;
```

---

## API

The Worker is routed on `/api/*` on **both** hostnames — same code, same
D1, so each frontend calls its own same-origin API (no cross-origin
credentialed requests, no CORS/cookie complexity).

| Method | Path | Host | Auth | Description |
|---|---|---|---|---|
| `GET` | `/api/covers` | `app.` | Access | All covers, ordered by date desc |
| `GET` | `/api/matches` | either | — | All match dates |
| `GET` | `/api/stats` | `capas.` | — | Public aggregate results (per-paper breakdown, per-day winners, latest classified day) — reads only `analytics_covers` |
| `GET` | `/api/swipes` | `app.` | Access | Authenticated user's swipe history |
| `POST` | `/api/swipes` | `app.` | Access | Record a swipe `{ cover_id, decision }`; also refreshes that cover's `analytics_covers` row |
| `POST` | `/api/favorites` | `app.` | Access | Toggle a personal bookmark on an already-swiped cover `{ cover_id, favorite }` — unrelated to `decision` |
| `GET` | `/api/leaderboard` | `app.` | Access | Swipe count ranked by user |
| `GET` | `/api/scrape` | `capas.` | Bearer | Trigger scraper manually (see below) |
| `POST` | `/api/backfill-thumbs` | `capas.` | Bearer | One-off: generates `thumb_url` for 25 covers per call (Workers execution limits rule out doing this in one shot for 1000+ covers) — returns `{done, remaining}`, call repeatedly until `remaining` is 0 |
| `POST` | `/api/backfill-ai` | `capas.` | Bearer | One-off: classifies 8 covers per call, newest first — returns `{done, attempted, remaining}`, call repeatedly. Batch is smaller than the thumbnail one because each cover is a multi-second model call |
| `GET`/`POST`/`DELETE` | `/api/comments` | either | — / Google | Ephemeral comments on the current day's covers; wiped when the covers change |
| `POST` | `/api/notify` | `capas.` | Bearer | Send the daily notification mail |

---

## Deployment

### Worker

Deploys automatically via GitHub Actions on push to `api/**` or `wrangler.toml`.  
Manual deploy:

```bash
wrangler deploy
```

Secrets must be set once:

```bash
wrangler secret put ADMIN_SECRET
wrangler secret put R2_PUBLIC_URL
```

### R2 CORS policy

The bucket CORS policy is stored in `cors.json`. Apply it with:

```bash
wrangler r2 bucket cors put capas-storage --file cors.json
```

### Frontend

Deployed automatically by the two git-connected Cloudflare Pages
projects (`capas-landing`, `capas-app`) on every push to this branch —
no build step, no GitHub Actions workflow involved.

> The frontend used to be served by GitHub Pages. DNS has moved off it,
> but the repo's Pages source setting (Settings → Pages) hasn't been
> switched to "None" yet — cosmetic cleanup, not urgent.

---

## Scraping

### Automatic (cron)

The Worker runs hourly from **05:00–08:00 UTC** (06:00–09:00/07:00–10:00 Lisbon), scraping today's cover for each newspaper. Running four times ensures the cover is captured even if sapo.pt is slow to publish.

### Manual (GitHub Actions)

Two workflows are available under **Actions**:

- **Scrape Newspaper Covers** — trigger with a `days` count (last N days)
- **Scrape Newspaper Covers (Date Range)** — trigger with `start` and `end` in `YYYYMMDD` format

Both require `ADMIN_SECRET` to be set in repository secrets.

### Manual (curl)

```bash
# Last 2 days
curl -H "Authorization: Bearer <secret>" "https://capas.digasnikas.com/api/scrape?days=2"

# Specific date range (max 7 days per call)
curl -H "Authorization: Bearer <secret>" "https://capas.digasnikas.com/api/scrape?start=20260408&end=20260414"

# One-off: backfill thumb_url for covers that predate thumbnails.
# Processes 25 per call — loop until "remaining" hits 0.
until curl -s -X POST -H "Authorization: Bearer <secret>" \
  "https://capas.digasnikas.com/api/backfill-thumbs" | tee /dev/stderr | grep -q '"remaining":0'; do sleep 1; done

# One-off: classify covers that predate the AI detector.
# Processes 8 per call, newest first — safe to Ctrl-C once the sample is big enough.
until curl -s -X POST -H "Authorization: Bearer <secret>" \
  "https://capas.digasnikas.com/api/backfill-ai" | tee /dev/stderr | grep -q '"remaining":0'; do sleep 1; done
```

### Bulk backfill (full month)

For scraping large amounts of covers at once, use `scrape_month.sh` — it calls the `/scrape` API for every day in a given month:

```bash
ADMIN_SECRET=<secret> ./scripts/scrape_month.sh 2025 11
```

This is the main way to backfill a full month without triggering the GitHub Actions workflow day by day or crafting individual curl commands.

---

## AI Detector

The landing page's second verdict card. Same three covers, same arithmetic,
same layout as "Hoje é dia de quem?" — but the club comes from a vision model
reading the front page instead of from votes.

**Zero-shot: nothing here is trained on this archive.** The model is shown the
cover and asked which club the page is about. The 1255 crowd-labelled covers
are used as a *benchmark*, never as training data.

### Model choice

Picked by benchmarking against 30 randomly sampled crowd-labelled covers:

| Model | Input | Agreement |
|---|---|---|
| **`@cf/meta/llama-4-scout-17b-16e-instruct`** | full-res | **87%** |
| `@cf/meta/llama-3.2-11b-vision-instruct` | full-res | 67% |
| `@cf/meta/llama-3.2-11b-vision-instruct` | 220px thumb | 53% |

Two things drive that gap, and both shaped the implementation:

- **Covers are decided by the headline text, not by kit colours.** So the
  classifier fetches the full-res original back out of R2 rather than reusing
  the 220px thumbnail the rest of the site runs on — at thumbnail resolution
  the Portuguese headline is unreadable and accuracy collapses.
- **Making the model quote the headline before answering is worth ~7 points.**
  The prompt asks for the headline first and an `ANSWER: <club>` line second,
  so the reply arrives as prose and is parsed back down to one of four keys.

> That 87% is *agreement with the crowd*, not correctness. At least one of the
> four disagreements — "rui costa seduz ríos" — is a cover the model read right
> and the vote read wrong. Treat the number as "how often the machine and the
> room land in the same place", which is what the page actually claims.

### Where it runs

Classification happens at the end of a successful scrape, *after* the D1 insert
— the cover is worth keeping whether or not the model has an opinion about it.
`classifyAndStore` swallows its own errors for the same reason: a model hiccup
must never take down the daily scrape. An unclassified cover is simply absent
from the AI section until a backfill picks it up.

`/api/stats` returns a second `latestAi` block alongside `latest`. Papers the
backfill hasn't reached yet are *excluded* from the day's verdict rather than
counted as misses, so an in-progress backfill can't skew it.

### Cost

~$0.0006 per cover ($0.27/M input + $0.85/M output tokens). Three covers a day
is roughly **€0.65/year**; classifying the entire archive is a **one-off €0.75**.
The backfill exists to give the "concorda com a comunidade em X% das N capas"
line a denominator worth quoting — the section itself only ever shows today.

---

## Match Dates

The calendar highlights days after a match to make it easier to find covers that might feature a club's result. Match dates are imported manually into D1:

```bash
FOOTBALL_API_KEY=<key> APISPORTS_KEY=<key> python3 scripts/import_matches.py
```

Data sources: [football-data.org](https://www.football-data.org) (Primeira Liga + European cups) and [api-sports.io](https://dashboard.api-football.com) (Taça de Portugal + Taça da Liga). Both have free tiers.
