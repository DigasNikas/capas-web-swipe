# Avaliador de Capas Desportivas ⚽

A crowd-sourced tool for cataloguing Portuguese sports newspaper front pages. Users swipe covers left/right/up/down to classify which football club dominates each edition — Benfica (←), Sporting (→), Porto (↓), or Other (↑).

Live at **[capas.digasnikas.com](https://capas.digasnikas.com)**

---

## How It Works

1. Every morning a **Cloudflare Worker** scrapes the front page of three newspapers from sapo.pt and stores them in **R2** (images) and **D1** (metadata).
2. The **frontend** loads the covers, presents them as a swipeable card stack, and records each user's classification back to the Worker API.
3. Authentication is handled by **Cloudflare Access** — the Worker reads the `Cf-Access-Authenticated-User-Email` header to identify users.

---

## Project Structure

```
capas-web-swipe/
├── index.html            Frontend entry point
├── style.css             All styles
├── app.js                Frontend entry (ES module): event listeners + init()
├── CNAME                 Custom domain for GitHub Pages
├── wrangler.toml         Cloudflare Worker configuration
├── package.json          Wrangler dev dependency
│
├── src/                  Frontend ES modules (imported by app.js)
│   ├── state.js          Shared mutable state + all constants (ACTIONS, API_URL, …)
│   ├── dom.js            DOM element references
│   ├── dates.js          Date/time formatting and grouping helpers
│   ├── calendar.js       Calendar rendering, month navigation, date-click handler
│   ├── ui.js             Progress bar, date header, empty state updates
│   ├── cards.js          Card stack, swipe gestures, commit logic, group navigation
│   ├── catalogue.js      Histórico modal (drill-down, filters, image grid)
│   ├── leaderboard.js    Leaderboard modal (fetch + render)
│   └── modals.js         animateModalClose, swipe-down-to-close, instrucoes modal
│
├── workers/              Cloudflare Worker (single bundle, split by responsibility)
│   ├── index.js          Router + cron entry point
│   ├── schema.sql        D1 database schema
│   ├── lib/
│   │   ├── http.js       CORS headers + json() helper
│   │   └── scraper.js    Scraping logic (fetch → HTMLRewriter → R2 + D1)
│   └── handlers/
│       ├── covers.js     GET  /covers
│       ├── matches.js    GET  /matches
│       ├── swipes.js     GET  + POST /swipes
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

The frontend uses native ES modules (`<script type="module">`) — no build step required. Modules share state via the `state` object exported from `src/state.js`, which is passed by reference across all imports.

> **Note:** ES modules require a server context. `index.html` cannot be opened via `file://` — use `wrangler dev` or any local HTTP server for local testing.

---

## Infrastructure

| Resource | Provider | Purpose |
|---|---|---|
| Frontend hosting | GitHub Pages | Serves `index.html`, `style.css`, `app.js` |
| Worker | Cloudflare Workers | API + scheduled scraper |
| Database | Cloudflare D1 (SQLite) | Covers metadata, swipes, match dates |
| Image storage | Cloudflare R2 | Front page images |
| Auth | Cloudflare Access | User identity via email |

### D1 Schema

**`covers`** — one row per newspaper per day  
**`swipes`** — one row per user per cover (upserted on re-swipe)  
**`matches`** — match dates for Sporting, Benfica, Porto (used to highlight the calendar)

---

## API

All endpoints live under `https://capas.digasnikas.com/api/`.  
Authenticated endpoints require a valid Cloudflare Access session cookie.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/covers` | Access | All covers, ordered by date desc |
| `GET` | `/matches` | — | All match dates |
| `GET` | `/swipes` | Access | Authenticated user's swipe history |
| `POST` | `/swipes` | Access | Record a swipe `{ cover_id, decision }` |
| `GET` | `/leaderboard` | Access | Swipe count ranked by user |
| `GET` | `/scrape` | Bearer | Trigger scraper manually (see below) |

---

## Deployment

### Worker

Deploys automatically via GitHub Actions on push to `workers/**` or `wrangler.toml`.  
Manual deploy:

```bash
wrangler deploy
```

Secrets must be set once:

```bash
wrangler secret put ADMIN_SECRET
wrangler secret put R2_PUBLIC_URL
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
