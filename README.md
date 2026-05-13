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
├── app.js                Frontend logic (vanilla JS)
├── CNAME                 Custom domain for GitHub Pages
├── wrangler.toml         Cloudflare Worker configuration
├── package.json          Wrangler dev dependency
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
| `GET` | `/covers` | — | All covers, ordered by date desc |
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

The Worker runs daily at **04:00 UTC** (05:00/06:00 Lisbon), scraping today's cover for each newspaper.

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

### Local Python scrapers

The scripts in `scripts/` download covers locally (useful for bulk backfills before the Worker was set up):

```bash
cd scripts
python3 scrape_all.py 7          # scrape last 7 days for all newspapers
python3 scrape_record.py 30      # just Record, last 30 days
```

---

## Match Dates

The calendar highlights days after a match to make it easier to find covers that might feature a club's result. Match dates are imported manually into D1:

```bash
FOOTBALL_API_KEY=<key> APISPORTS_KEY=<key> python3 scripts/import_matches.py
```

Data sources: [football-data.org](https://www.football-data.org) (Primeira Liga + European cups) and [api-sports.io](https://dashboard.api-football.com) (Taça de Portugal + Taça da Liga). Both have free tiers.
