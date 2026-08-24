# Archive views

Two ways of looking at the whole archive at once, both zero-AI.

## Código de barras (under the calendar)

One 3px stripe per day, coloured by the club of that day's cover, one row per paper — a whole season of the Portuguese sports press readable in one glance. Pure frontend: `renderBarcode()` in `landing.js` reuses the `days` array the calendar already builds, so it follows the época dropdown and adds no request, no endpoint and no asset. It scrolls sideways rather than dropping days; the paper labels are `position: sticky` so they survive the scroll.

**Linked to the calendar, both ways.** Picking a day in either the calendar grid or the barcode selects it in both: the picked stripe enlarges the same way the calendar's own selected cell does (scale + outline + shadow, JS-toggled so it also works from a tap), and clicking a stripe opens that day in the day panel exactly like clicking a calendar cell does. `renderCalendar` returns a `selectByDate(date)` function that both its own cell clicks and the barcode's `onSelect` callback route through — the two renderers close over each other via a forward-declared binding in `renderEpoca`, since neither exists yet when the other needs to be handed a reference to it.

## A capa média

`scripts/avg_cover.py` downloads every full-res cover and averages them pixel-wise, per paper and per paper+club. The masthead sits in the same place on every edition so it comes out razor sharp; the headlines move around and dissolve into a ghost. Per club, the colour cast is the story: A Bola's Sporting mean is green, its Porto mean is blue.

Two eras of scraping are in the archive — the older files keep an advertising strip above the masthead, the newer ones crop it off — so the covers are aligned before averaging: each page's per-row mean brightness is a 1D fingerprint of its horizontal bands, and a cross-correlation against the paper's newest cover gives the vertical offset. Without it every masthead prints twice. (A third era — sapo.pt-fallback covers, see [Scraping](#scraping) — has a slightly different crop too and aligns the same way.)

Runs locally (it pulls ~1250 JPEGs, ~90s on 12 threads), never in the Worker. Output is committed to `landing/avg/` — 15 JPEGs plus `counts.json` — so the page just fetches static files, and the section stays hidden if they're absent.

```bash
python3 -m venv .venv && .venv/bin/pip install numpy pillow
.venv/bin/python scripts/avg_cover.py     # rerun after a big backfill
```

**One section, filterable by club.** "Todas as capas ao mesmo tempo" shows the three papers' plain means by default (`Todos`); a club filter above the grid switches all three to that club's mean at once (`{paper}-{club}.jpg`), so they stay comparable side by side. This used to be two separate sections — a per-paper grid and a second "O mesmo jornal, quatro humores" section with its own paper filter, organised the other way around (one paper, all four clubs) — merged into one because the club-filtered view is the one people actually compare across papers with. Or trigger the **Regenerate A Capa Média** GitHub Action instead of running the script locally — see [Scraping](#scraping).
