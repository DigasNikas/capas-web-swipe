# Overview

A crowd-sourced tool for cataloguing Portuguese sports newspaper front pages. Users swipe covers left/right/up/down to classify which football club dominates each edition — Benfica (←), Sporting (→), Porto (↓), or Other (↑).

Live at **[capas.digasnikas.com](https://capas.digasnikas.com)** (the logged-in app lives on its own subdomain: **[app.capas.digasnikas.com](https://app.capas.digasnikas.com)**). This page — `/documentation` — is that codebase's manual; `README.md` at the repo root is just the map that points here.

## How it works

1. Every morning a **Cloudflare Worker** scrapes the front page of three newspapers (capasjornais.pt, falling back to sapo.pt — see [Scraping](#scraping)) and stores them in **R2** (images) and **D1** (metadata).
2. **`capas.digasnikas.com`** is the public landing page — it shows crowd-sourced results (which club each newspaper favours, a calendar of daily winners, the latest classified day) from a dedicated analytics table, no login required.
3. The same three covers are also read by a **vision model** (Workers AI, zero-shot — no training) and shown side by side with the crowd's verdict in the landing page's "Detetor AI" section — see [AI Detector](#ai-detector).
4. Clicking "Entrar" takes you to **`app.capas.digasnikas.com`**, a separate hostname behind **Cloudflare Access** — the Worker reads the `Cf-Access-Authenticated-User-Email` header to identify users and record their swipes.
5. Everything past login lives on that subdomain. "Conta" opens as a bottom-sheet modal over the swipe app (same pattern as the leaderboard and Instruções modals — no page navigation), showing a user's own stats, leaderboard rank, and swipe history. Access is configured as a multi-domain application, so signing in on one host authenticates the other too.

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

Both Pages projects git-connect to this repo/branch and deploy on every push — same push, same commit, two independent deploys (different `destination_dir` per project: `landing` vs `app`). See [Deployment](#deployment).

## D1 schema

**`covers`** — one row per newspaper per day. `url` is the full-res image; `thumb_url` is a generated 220px WebP thumbnail (nullable — falls back to `url` in `/api/covers` and `/api/stats` for covers scraped before thumbnails existed; backfill with `/api/backfill-thumbs`). Thumbnails feed small on-screen previews (landing calendar, catalogue grid); the swipe card and cover modal always use the full-res `url`.

`ai_club` is the model's own guess for that cover (nullable — absent until classified; backfill with `/api/backfill-ai`), and `ai_headline` is the headline it quoted back while guessing, kept so a wrong label can be diagnosed with one query instead of by opening the image. A NULL `ai_headline` also marks a cover as classified by an older prompt, which is how the backfill knows to re-label it. Both sit on `covers` rather than beside the votes because neither is a vote and neither has a user attached to it.

**`swipes`** — one row per user per cover (upserted on re-swipe)

**`matches`** — match dates for Sporting, Benfica, Porto (used to highlight the calendar) — see [Match dates](#match-dates)

**`analytics_covers`** — one row per cover with ≥1 vote: the winning club + vote counts, refreshed on every swipe. Never joined with `swipes`/`user_email`, which is the rule that keeps the public API private: `/api/stats` reads `analytics_covers` for anything vote-shaped, joining `covers` only for image URLs and `ai_club` — columns with no user attached to them.

`ai_club` and `ai_headline` were added after the fact. An existing database needs them applied by hand; `schema.sql` already has them for a fresh one:

```sql
ALTER TABLE covers ADD COLUMN ai_club TEXT;
ALTER TABLE covers ADD COLUMN ai_headline TEXT;
```
