# Avaliador de Capas Desportivas ⚽

A crowd-sourced tool for cataloguing Portuguese sports newspaper front pages. Users swipe covers left/right/up/down to classify which football club dominates each edition — Benfica (←), Sporting (→), Porto (↓), or Other (↑).

Live at **[capas.digasnikas.com](https://capas.digasnikas.com)**

---

## How It Works

1. Every morning a **Cloudflare Worker** scrapes the front page of three newspapers from sapo.pt and stores them in **R2** (images) and **D1** (metadata).
2. The **landing page** (`/`) is public — it shows crowd-sourced results (which club each newspaper favours, a calendar of daily winners, the latest classified day) from a dedicated analytics table, no login required.
3. Clicking "Entrar" takes you to the **swipe app** (`/app/`), which is behind **Cloudflare Access** — the Worker reads the `Cf-Access-Authenticated-User-Email` header to identify users and record their swipes.
4. Everything past login lives under `/app/*` — the **account page** (`/app/account/`) shows a user's own stats, leaderboard rank, and swipe history, and future logged-in pages join it there.

---

## Project Structure

```
capas-web-swipe/
├── index.html            Public landing page (results, no login) — pinned at root by GitHub Pages
├── landing/
│   ├── landing.js        Fetches /api/stats + /api/matches, renders the landing page
│   └── landing.css       Landing page styles (separate visual language from the app)
│
├── app/                  Everything behind Cloudflare Access lives under here
│   ├── index.html        Swipe app
│   ├── app.js            Swipe app entry (ES module): event listeners + init()
│   └── account/          First of what will be more logged-in subpages
│       ├── index.html    Account page: stats, rank, Histórico
│       └── account.js    Account page logic
│
├── style.css             Styles shared by the app + account pages
├── CNAME                 Custom domain for GitHub Pages
├── wrangler.toml         Cloudflare Worker configuration
├── package.json          Wrangler dev dependency
│
├── src/                  Frontend ES modules shared by app.js and account.js
│   ├── state.js          Shared mutable state + all constants (ACTIONS, API_URL, …)
│   ├── dom.js            DOM element references (app page)
│   ├── dates.js          Date/time formatting and grouping helpers
│   ├── calendar.js       Calendar rendering, month navigation, date-click handler
│   ├── ui.js             Progress bar, date header, empty state updates
│   ├── cards.js          Card stack, swipe gestures, commit logic, group navigation
│   ├── catalogue.js      Histórico rendering (drill-down, filters, image grid)
│   ├── leaderboard.js    Leaderboard modal (fetch + render)
│   └── modals.js         animateModalClose, swipe-down-to-close, instrucoes modal
│
├── api/                  Cloudflare Worker (single bundle, split by responsibility)
│   ├── index.js          Router + cron entry point
│   ├── schema.sql        D1 database schema
│   ├── lib/
│   │   ├── http.js       CORS headers + json() helper
│   │   └── scraper.js    Scraping logic (fetch → HTMLRewriter → R2 + D1)
│   └── handlers/
│       ├── covers.js     GET  /covers
│       ├── matches.js    GET  /matches
│       ├── stats.js      GET  /stats  (public — reads analytics_covers only, never swipes)
│       ├── swipes.js     GET  + POST /swipes (POST also refreshes analytics_covers)
│       ├── leaderboard.js GET /leaderboard
│       └── scrape.js     GET  /scrape  (admin, bearer-protected)
│
├── scripts/              Local tooling (not deployed)
│   ├── scrape_all.py     Run all three newspaper scrapers locally
│   ├── scrape_record.py  Scrape Record covers from sapo.pt
│   ├── scrape_abola.py   Scrape A Bola covers from sapo.pt
│   ├── scrape_ojogo.py   Scrape O Jogo covers from sapo.pt
│   ├── scrape_month.sh   Trigger the /scrape API for a full calendar month
│   └── import_matches.py Import match dates into D1 (football-data.org + api-sports.io)
│
└── images/               Newspaper logos (static assets for the frontend)
    ├── abola.png
    ├── ojogo.png
    ├── record.png
    └── manifest.json
```

The frontend uses native ES modules (`<script type="module">`) — no build step required. Each page's HTML lives in its own folder next to its entry JS (`app/app.js`, `app/account/account.js`, `landing/landing.js`); `index.html` is the one exception, pinned at the repo root because GitHub Pages needs it there to serve `/`. Every cross-folder reference (`src/*.js`, `style.css`) uses an absolute path (`/src/state.js`) rather than a relative one, so it resolves the same regardless of which page imports it. Modules share state via the `state` object exported from `src/state.js`, which is passed by reference across all imports.

> **Note:** ES modules require a server context. Pages can't be opened via `file://` — use `wrangler dev` or any local HTTP server for local testing.

---

## Infrastructure

| Resource | Provider | Purpose |
|---|---|---|
| Frontend hosting | GitHub Pages | Serves the static pages (`/`, `/app/`, `/app/account/`) |
| Worker | Cloudflare Workers | API + scheduled scraper |
| Database | Cloudflare D1 (SQLite) | Covers metadata, swipes, match dates, public analytics |
| Image storage | Cloudflare R2 | Front page images |
| Auth | Cloudflare Access | Gates `/app*` (covers `/app/account/` and any future logged-in subpage) plus `/api/covers*`, `/api/swipes*`, `/api/leaderboard*` — everything else (`/`, `/api/stats`, `/api/matches`) is public |

### D1 Schema

**`covers`** — one row per newspaper per day  
**`swipes`** — one row per user per cover (upserted on re-swipe)  
**`matches`** — match dates for Sporting, Benfica, Porto (used to highlight the calendar)  
**`analytics_covers`** — one row per cover with ≥1 vote: the winning club + vote counts, refreshed on every swipe. Never joined with `swipes`/`user_email` — this is the only table the public landing page's API reads.

---

## API

All endpoints live under `https://capas.digasnikas.com/api/`.  
Authenticated endpoints require a valid Cloudflare Access session cookie.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/covers` | Access | All covers, ordered by date desc |
| `GET` | `/matches` | — | All match dates |
| `GET` | `/stats` | — | Public aggregate results (per-paper breakdown, per-day winners, latest classified day) — reads only `analytics_covers` |
| `GET` | `/swipes` | Access | Authenticated user's swipe history |
| `POST` | `/swipes` | Access | Record a swipe `{ cover_id, decision }`; also refreshes that cover's `analytics_covers` row |
| `GET` | `/leaderboard` | Access | Swipe count ranked by user |
| `GET` | `/scrape` | Bearer | Trigger scraper manually (see below) |

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

Deployed automatically by GitHub Pages from the `main` branch root.

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
```

### Bulk backfill (full month)

For scraping large amounts of covers at once, use `scrape_month.sh` — it calls the `/scrape` API for every day in a given month:

```bash
ADMIN_SECRET=<secret> ./scripts/scrape_month.sh 2025 11
```

This is the main way to backfill a full month without triggering the GitHub Actions workflow day by day or crafting individual curl commands.

---

## Match Dates

The calendar highlights days after a match to make it easier to find covers that might feature a club's result. Match dates are imported manually into D1:

```bash
FOOTBALL_API_KEY=<key> APISPORTS_KEY=<key> python3 scripts/import_matches.py
```

Data sources: [football-data.org](https://www.football-data.org) (Primeira Liga + European cups) and [api-sports.io](https://dashboard.api-football.com) (Taça de Portugal + Taça da Liga). Both have free tiers.
