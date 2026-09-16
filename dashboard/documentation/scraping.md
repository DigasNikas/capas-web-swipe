# Scraping

One cover per newspaper per day, stored in R2 with a row in D1.

| | |
|---|---|
| Sources | capasjornais.pt (primary), sapo.pt (fallback) |
| Schedule | Worker cron, 05:00–08:00, 10:00 and 13:00 UTC |
| Code | `scrapeNewspaper`, `scrapeDay` (`api/lib/scraper.js`) |
| Writes | R2 cover + 220px WebP thumbnail, `covers` row, `headlines` when available |
| Endpoint | `POST /api/scrape?days=` / `?start=&end=` (admin) |
| Classifies | Nothing. See [AI Detector](#ai-detector) |

## Idempotent by design

Every cron runs the same function against today, and it converges:

| Row state | What happens |
|---|---|
| Missing | Cover fetched and stored; titles filled if the source has turned over |
| Present, no titles, dated today | Titles fetched and written. No image re-download |
| Present with titles | Nothing, no request |
| Present, no titles, past date | Nothing: no source exists |

`scrapeNewspaper` returns `complete`, `pending` or `failed`; `scrapeDay` runs all three papers, catching each separately, and reports whether the day is settled. Running it six times a day costs three D1 reads once a day is done. `node api/lib/scrape-day.test.mjs` pins that.

## Sources

**capasjornais.pt** first: no watermark, and the URL is computable from the date, so there's no page to parse.

```
https://capasjornais.pt/img/FrontPages/{YYYYMM}/{paper}_{DDMMYYYY}.jpg
                                                 jornal_a_bola
                                                 jornal_record
                                                 jornal_o_jogo
```

Missing dates 404 cleanly: a miss logs a line and writes nothing. Back issues go years deep, so the same URL serves backfills. `node api/lib/scraper.test.mjs` guards the date munging — capasjornais.pt writes `DDMMYYYY` under a `YYYYMM` folder, sapo.pt writes `YYYYMMDD`.

**sapo.pt** is used only when capasjornais.pt 404s or is down, and it does go down: on 2026-08-24 it stopped answering on both ports for hours and every scrape logged `522`. Its page is parsed with HTMLRewriter (`.article-newspaper img`), and it carries no headline text ([Headlines](#headlines)).

Full-res framing differs between the two (~960×1230 versus sapo's crop), so a stretch scraped from the fallback is a third "era" for `scripts/avg_cover.py` to align. Rerun it after a long fallback stretch ([Archive views](#archive-views)).

## Running it by hand

```bash
# Last 2 days
curl -X POST -H "Authorization: Bearer <secret>" "https://capas.digasnikas.com/api/scrape?days=2"

# A date range, max 7 days per call (the Worker's subrequest limit)
curl -X POST -H "Authorization: Bearer <secret>" "https://capas.digasnikas.com/api/scrape?start=20260408&end=20260414"

# A whole month, one /scrape call per day
ADMIN_SECRET=<secret> ./scripts/scrape_month.sh 2025 11
```

The **Scrape Newspaper Covers** workflow does the same three things through its `mode` input: `days`, `range`, or `month` (which wraps `scrape_month.sh`).

Past-date scrapes leave `headlines` `NULL` — the source only serves today's titles. [Headlines](#headlines) covers the separate archive backfill.

## Why the workflow uses workers.dev

A runner calling `capas.digasnikas.com` gets **403** with ~5 KB of HTML: Cloudflare **Bot Fight Mode** issues a managed challenge because GitHub's runners come from Azure IPs (`firewallEventsAdaptive`: `ruleId: bot_fight_mode`, `clientASNDescription: Microsoft Corporation`). The Free plan has no per-path exemption.

The workflows call `https://capas-scraper.digasnikas-digital.workers.dev` instead (`workers_dev = true`). That hostname is off the zone, so Bot Fight Mode never sees it; the Worker's own `ADMIN_SECRET` check and the Access JWT checks are unchanged. A laptop is not challenged, so `capas.digasnikas.com/api` still works by hand.

A wrong token looks different: a 12-byte `401`.

## Workflows and their secrets

| Workflow | Trigger | Needs |
|---|---|---|
| `scrape.yml` | Manual | `ADMIN_SECRET` |
| `rag-classify.yml` | `cover-first-vote`, `classify-backlog`, manual | `ADMIN_SECRET`, Cloudflare token with **Workers AI · Read** + **Vectorize · Read** |
| `vectorize-covers.yml`, `vectorize-headlines.yml` | `cover-first-vote`, manual | `ADMIN_SECRET`, Cloudflare token with **Vectorize · Write** |
| `avg-cover.yml` | Manual | None; commits `dashboard/avg/` if the pixels changed |
| `import-matches.yml` | Manual | `FOOTBALL_API_KEY`, optional `APISPORTS_KEY` |
| `checks.yml` | Every push and pull request | None; runs every self-check plus `git diff --check` |

The two dispatch events need `GH_DISPATCH_TOKEN` on the Worker (`wrangler secret put GH_DISPATCH_TOKEN`, a classic PAT with `repo` scope). See [AI Detector](#ai-detector).

`scripts/eval-ai.mjs` is deliberately not a workflow: run it locally ([Multimodal](#multimodal)).
