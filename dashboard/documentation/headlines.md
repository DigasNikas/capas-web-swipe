# Headlines

`covers.headlines` is the real headline text from that day's front page,
scraped straight off capasjornais.pt — not `ai_headline`, which is what
the vision model quotes back while guessing a club (see
[AI Detector](#ai-detector)). The two can disagree; `headlines` is ground
truth from the source, `ai_headline` is the model's own reading of the
image. This page covers how the column gets filled in; see
[Search](#search) for what reads it.

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

capasjornais.pt's per-newspaper page (`/Capa-Jornal-Record.html`, etc.)
has no date parameter — it always shows *today's* edition, whatever day
it happens to be fetched. `scrapeNewspaper` only calls `fetchHeadlines`
when the date being scraped is the actual current date; a backfill run
for a past date (`?start=`/`?end=`, `scrape_month.sh`) would otherwise
fetch today's headlines and write them onto the wrong cover. Past-date
scrapes, and the sapo.pt fallback path, both leave `headlines` `NULL`.

## Filling gaps from the same day

A cover already scraped earlier today, before this column existed (or
before a code path that sets it), is never touched again by
`scrapeNewspaper` — inserting only happens once, on first scrape.
`POST /api/backfill-headlines` (admin, bearer-protected) closes that gap:
it finds covers with `date = today` and `headlines IS NULL`, calls the
same `fetchHeadlines` the live scraper uses, and `UPDATE`s them in place.
Today-only for the same reason as the live scrape — there's no other
page to fetch a past date's headlines from here.

```bash
curl -X POST -H "Authorization: Bearer <ADMIN_SECRET>" \
  https://capas.digasnikas.com/api/backfill-headlines
```

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

`headlines` sits on `covers` next to the other nullable, added-after-the-fact
columns (`ai_club`, `vectorized_at`, etc. — see [Overview](#overview)'s D1
schema). As of the first historical backfill run: 1438 of 1821 covers have
it (1433 from the archive backfill, the rest from the live scrape and the
same-day backfill).
