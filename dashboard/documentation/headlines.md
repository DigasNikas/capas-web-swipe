# Headlines

`covers.headlines` is the front page's own title text, scraped from capasjornais.pt. Distinct from `ai_headline`, which is the headline the vision model quotes back while guessing a club ([Multimodal](#multimodal)): this one is the source's text, that one is the model's reading of the image.

| | |
|---|---|
| Source | capasjornais.pt's "Títulos da Capa" block |
| Format | Every title on the page, joined with `•` |
| Written by | `scrapeNewspaper` (today), `scripts/backfill_headlines_archive.mjs` (past dates) |
| Parser | `extractHeadlinesFromHtml`, `headlinesIfFresh` (`api/lib/scraper.js`) |
| Coverage | **1,675 of 1,872** covers (2026-09-16) |

Read by four things: [Search](#search) indexes it, the classifier folds it into the prompt ([AI Detector](#ai-detector)), [Headline Embeddings](#headline-embeddings) embeds its lead story, and `GET /api/headlines` serves it to `rag_classify.py --eval`.

## Where the text comes from

Of the two scrape sources ([Scraping](#scraping)), only capasjornais.pt carries text. Its per-newspaper page has one `<li><span>` under `<h2 class="BottomNews">` holding the whole day's titles. sapo.pt, the fallback, has none: a paper name, a date and an archive link.

Record for 2026-08-30:

```
Palhinha já é da casa • Empréstimo pode ser solução para Ríos e Trubin •
Dragões passeiam na Beira e mantêm arranque perfeito: Campeão da
eficácia – Portistas fizeram cinco remates e marcaram nos três
primeiros • Zaidu com suspeita de lesão grave • ...
```

`extractHeadlinesFromHtml` parses that with plain string operations, not `HTMLRewriter`: the archive backfill runs it outside the Worker, and it stays testable with plain `node` (`scraper.test.mjs`).

## Today: the scrape fills it

capasjornais.pt's per-newspaper page takes no date parameter — it shows the current edition, which early in the morning is still yesterday's. `headlinesIfFresh` compares the page's own heading against the date being scraped and returns `null` on a mismatch, so a cover never receives another edition's text.

`scrapeNewspaper` is idempotent and every cron runs it (05:00–08:00, 10:00, 13:00 UTC):

| Row state | What happens |
|---|---|
| Missing | Cover fetched and stored; titles filled if the page has turned over |
| Present, no titles, dated today | Titles fetched and written. No image re-download |
| Present with titles | Nothing, no request |
| Present, no titles, past date | Nothing: no source exists |

Today's titles land on the first cron after the page turns over. A past-date scrape (`?start=`/`?end=`, `scrape_month.sh`) and the sapo.pt fallback both leave the column `NULL`.

A cover dated today is not classifiable until its titles are stored ([AI Detector](#ai-detector)), so a label is never produced without them.

## Past dates: the archive backfill

The per-newspaper page only ever shows today, so a past cover has no source there. capasjornais.pt has a second page per newspaper per month — `capas/Arquivo-Jornal-Record-Mes-agosto-2026.html` — listing that month's covers as dated permalinks (`Capa-Jornal-Record-dia-01-Agosto-2026-103375.html`), each carrying the same "Títulos da Capa" block.

`scripts/backfill_headlines_archive.mjs`:

1. `GET /headline-candidates?limit=` — covers missing `headlines`, oldest first.
2. Fetch that newspaper's archive page for the month, once per newspaper/month, cached.
3. Parse the candidate's dated permalink from it, fetch it, run `headlinesIfFresh` against the cover's own date.
4. `POST /update-headline {id, headlines}`, one cover at a time, so a crash keeps earlier progress.

```bash
ADMIN_SECRET=… node scripts/backfill_headlines_archive.mjs
... node scripts/backfill_headlines_archive.mjs --limit 50    # smoke test
... node scripts/backfill_headlines_archive.mjs --delay 500   # more polite
```

Local-only, not a workflow: capasjornais.pt's tolerance for runner IPs at this volume (~1,800 requests for the first run) is untested, and a backfill runs once per gap rather than on a schedule.

Month names fold to ASCII on both sides. The archive URL spelt `março` returns January's page with HTTP 200, and permalinks spell it `Marco`.

## What stays empty

197 covers, all of them voted:

| Month | Covers | Reason |
|---|---|---|
| 2025-10 | 90 | capasjornais.pt publishes no headline block for those editions |
| 2025-09 | 75 | Same |
| Scattered | 32 | Single days with the same gap |

Not a backlog: the source has nothing to fetch. Those covers classify on the image alone, are absent from [Headline Embeddings](#headline-embeddings), and get no `others` gate score.
