# Match dates

The calendar highlights days after a match to make it easier to find covers that might feature a club's result. Match dates live in D1's `matches` table, filled by a weekly job and importable by hand:

```bash
FOOTBALL_API_KEY=<key> APISPORTS_KEY=<key> python3 scripts/import_matches.py
```

Data sources: [football-data.org](https://www.football-data.org) (Primeira Liga, Champions League), [match.uefa.com](https://match.uefa.com) (all three European competitions, qualifying rounds included) [ligaportugal.pt](https://www.ligaportugal.pt) (Taça da Liga) and [api-sports.io](https://dashboard.api-football.com) (Taça de Portugal and Taça da Liga, but only through 2024-25 on the free plan).

UEFA's own feed is there because football-data's free tier answers 403 for the Europa League and 404 for the Conference League, which is how Porto's whole 2025-26 European campaign went missing. It needs no key, and it also carries the July and August qualifiers that the competition feeds skip. It does answer 403 to urllib's default user agent, hence the browser one in the script. The Champions League is read from both sources on purpose, so one going quiet doesn't lose a European night.

The Taça da Liga comes from the API ligaportugal.pt's own site calls, which needs no key and publishes each round as it is drawn. The **Taça de Portugal has no free source for the current season**: api-sports serves it only through 2024-25, and the FPF site, zerozero, fbref and worldfootball all block automated requests. Those dates are simply absent until someone adds them by hand, which means a cup night can still produce a 🚨.

The morning after a European night, the day panel's block of covers sits inside a frame in that competition's colours, under a banner naming it. Each date is stored with its competition (`CL`, `PPL`, `EL`, `UECL`, `TP`, `TL`), which is what lets the calendar's alert say *Porto foi o único a jogar Champions League e não foi manchete em todas as capas* instead of just naming the club. A club playing two competitions on one day can't happen, but the same fixture arrives from both sources, so the European code wins over the domestic one rather than whichever import ran last. Rows imported before this column read as `NULL` and drop the competition from the sentence until that season is re-imported.

With no season argument it imports the season happening now (August to June).

The **Import Match Dates** GitHub Action runs this every Monday, and can be triggered by hand: pass a season year, leave it blank for the current one, or tick "list leagues" to print api-sports.io's Portuguese league IDs instead of importing anything. The weekly run matters because fixtures arrive all season — the Champions League league phase is drawn in late August and the knockout rounds from February. A European fixture missing from `matches` shows up on the dashboard as a 🚨 against papers that led with a club that did play. See [Scraping](#scraping) for the rest of the one-click workflows.
