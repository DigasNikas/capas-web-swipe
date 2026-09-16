# Headlines

`covers.headlines` is the real headline text from that day's front page,
scraped straight off capasjornais.pt — not `ai_headline`, which is what
the vision model quotes back while guessing a club (see
[AI Detector](#ai-detector)). The two can disagree; `headlines` is ground
truth from the source, `ai_headline` is the model's own reading of the
image. This page covers how the column gets filled in. Three things read it:
[Search](#search) indexes it, the classifier folds it into its prompt
(see [AI Detector](#ai-detector)'s "What the prompt carries"), and
`GET /api/headlines` serves it to `rag_classify.py --eval`.

## Where the text comes from

Of the two scrape sources (see [Scraping](#scraping)), only one carries
headline text:

- **sapo.pt** (fallback): nothing. The page has a paper name, a date, and
  an archive link — no article text of any kind.
- **capasjornais.pt** (primary): each newspaper's page has a "Títulos da
  Capa" block, one `<li><span>` under `<h2 class="BottomNews">`, every
  headline on the page already joined into a single string with `•`.

Record's edition for 2026-08-30, for example, came back as:

```
Palhinha já é da casa • Empréstimo pode ser solução para Ríos e Trubin •
Dragões passeiam na Beira e mantêm arranque perfeito: Campeão da
eficácia – Portistas fizeram cinco remates e marcaram nos três
primeiros • Zaidu com suspeita de lesão grave • ...
```

`extractHeadlinesFromHtml` (`api/lib/scraper.js`) pulls that block out
  with plain string parsing, not `HTMLRewriter` (used for the cover image
  itself, `extractCoverImage` in the same file) — this one needs to run
  outside the Worker too (see Historical backfill below), so it stays
  plain-string on purpose, testable with plain `node`, no Workers runtime
  needed. See `scraper.test.mjs`.

## Live scrape: today only

capasjornais.pt's per-newspaper page (`/Capa-Jornal-Record.html`, etc.) has no date parameter: it always shows the current edition, and early in the morning that is still yesterday's. `headlinesIfFresh` checks the page's own heading against the date being scraped and returns `null` on a mismatch, so a cover never receives another edition's text.

`scrapeNewspaper` is idempotent, and every cron runs it:

| Row state | What happens |
|---|---|
| Missing | Cover fetched and stored; titles filled if the page has turned over |
| Present, no titles, dated today | Titles fetched and written. No image re-download |
| Present with titles | Nothing, no request |
| Present, no titles, past date | Nothing: no source exists |

So today's titles land on the first cron that runs after the page turns over, without a separate endpoint or workflow. A past-date scrape (`?start=`/`?end=`, `scrape_month.sh`) and the sapo.pt fallback both leave `headlines` `NULL`.

`/rag-candidates` will not return a cover dated today until its titles are stored, so nothing is classified without them (see [AI Detector](#ai-detector)).

## Historical backfill

Covers scraped before this feature existed have no headline source at
the URLs above — those only ever show today. capasjornais.pt has a
second page per newspaper per month instead:
`capas/Arquivo-Jornal-Record-Mes-agosto-2026.html`, listing that whole
month's covers as dated permalinks —
`Capa-Jornal-Record-dia-01-Agosto-2026-103375.html` — and each of those
dated pages carries the exact same "Títulos da Capa" block the live
scraper reads, just for that specific day instead of today.

`scripts/backfill_headlines_archive.mjs` walks that path:

1. `GET /headline-candidates?limit=` (admin) — covers still missing
   `headlines`, oldest first.
2. For each candidate, fetch its newspaper's archive page for that
   month (once per newspaper/month, cached — a month archive page covers
   every candidate in it, not just one).
3. Parse the archive page for that candidate's dated permalink, fetch
   it, run it through the same `extractHeadlinesFromHtml`.
4. `POST /update-headline` (admin) `{id, headlines}` — one cover at a
   time, so a crash partway through the crawl loses no already-fetched
   progress.

```bash
ADMIN_SECRET=… node scripts/backfill_headlines_archive.mjs
... node scripts/backfill_headlines_archive.mjs --limit 50    # smoke test
... node scripts/backfill_headlines_archive.mjs --delay 500   # more polite
```

Local-only for now, not a GitHub Action — capasjornais.pt's tolerance for
runner IPs at this volume (~1800 requests for the initial run) is
untested, and a historical backfill only needs to run once per gap, not
on a schedule.

## Status

1,672 of 1,872 covers have `headlines` (2026-09-16). The 197 voted covers still missing it are 165 from September and October 2025, editions for which capasjornais.pt publishes no headline block at all, plus scattered days with the same gap.
