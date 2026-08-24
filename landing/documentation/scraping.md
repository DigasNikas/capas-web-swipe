# Scraping

## Automatic (cron)

The Worker runs hourly from **05:00–08:00 UTC** (06:00–09:00/07:00–10:00 Lisbon), scraping today's cover for each newspaper. Running four times ensures the cover is captured even if a source is slow to publish.

## Sources, primary and fallback

The scraper looks at **capasjornais.pt** first: its images carry no watermark (sapo.pt's do), and the URL is computable from the date alone — no page to fetch, no HTMLRewriter:

```
https://capasjornais.pt/img/FrontPages/{YYYYMM}/{paper}_{DDMMYYYY}.jpg
                                                 jornal_a_bola
                                                 jornal_record
                                                 jornal_o_jogo
```

Missing dates 404 cleanly, so a miss here is just a log line, not an error. `node api/lib/scraper.test.mjs` guards the date munging (capasjornais.pt writes `DDMMYYYY` under a `YYYYMM` folder, unlike sapo's `YYYYMMDD`). Back issues go years deep, so it covers backfills as well as day-to-day scraping.

**sapo.pt** — the archive's original source, and still the one whose page gets parsed (HTMLRewriter, `.article-newspaper img`) — is the fallback, used only when capasjornais.pt 404s or is down. It does go down: on 2026-08-24 it stopped answering on both :80 and :443 for hours — confirmed dead from three separate networks, not a block — and every scrape logged `Failed to fetch page ...: 522`, Cloudflare's "no answer from origin".

Full-res framing differs slightly between the two (~960×1230 on capasjornais.pt vs sapo's crop), so a stretch scraped from the fallback is a third "era" for `scripts/avg_cover.py` to align — it already cross-correlates (see [Archive views](#archive-views)), so this costs nothing, but rerun it after a long sapo.pt-fallback stretch.

## Manual (GitHub Actions)

> **Known failure:** the runner gets **403** with ~5 KB of HTML. That is not a bad `ADMIN_SECRET` — a wrong token returns a 12-byte `401`. It is Cloudflare **Bot Fight Mode** issuing a managed challenge, because GitHub's runners come from Microsoft/Azure IPs. Confirmed in `firewallEventsAdaptive`: `ruleId: bot_fight_mode`, `source: botFight`, `clientASNDescription: Microsoft Corporation`. The Free plan has no per-path exemption; the fixes are to publish the Worker on `workers.dev` and point the workflow there, or to run the curl locally, which is not challenged.

Every script in `scripts/` has a matching one-click workflow under **Actions**:

- **Scrape Newspaper Covers** — trigger with a `days` count (last N days)
- **Scrape Newspaper Covers (Date Range)** — trigger with `start` and `end` in `YYYYMMDD` format
- **Scrape Newspaper Covers (Full Month)** — trigger with `year` and `month`; wraps `scrape_month.sh`
- **Regenerate A Capa Média** — no inputs; runs `avg_cover.py` and commits `landing/avg/` straight to the branch if the pixels changed — see [Archive views](#archive-views)
- **Evaluate AI Prompt** — trigger with a sample size or "score everything"; wraps `eval-ai.mjs`, prints its report to the run log — see [AI Detector](#ai-detector)
- **Import Match Dates** — trigger with a season year, or tick "list leagues" to print api-sports.io league IDs instead; wraps `import_matches.py` — see [Match dates](#match-dates)

The three scrape workflows and `import_matches` need `ADMIN_SECRET` / `FOOTBALL_API_KEY` (+ optional `APISPORTS_KEY`) in repository secrets; `eval-ai` and `import_matches` also reuse the `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN` pair `deploy-worker.yml` already has — `eval-ai`'s token additionally needs **Workers AI · Read**, which the deploy token may not carry.

## Manual (curl)

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

## Bulk backfill (full month)

For scraping large amounts of covers at once, use `scrape_month.sh` — it calls the `/scrape` API for every day in a given month:

```bash
ADMIN_SECRET=<secret> ./scripts/scrape_month.sh 2025 11
```

Or trigger the **Scrape Newspaper Covers (Full Month)** Action instead of running it locally — same script, same Bot Fight Mode coin flip as the other two workflows.
