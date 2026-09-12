# Match dates

The calendar highlights days after a match to make it easier to find covers that might feature a club's result. Match dates live in D1's `matches` table, filled by a weekly job and importable by hand:

```bash
FOOTBALL_API_KEY=<key> APISPORTS_KEY=<key> python3 scripts/import_matches.py
```

Data sources: [football-data.org](https://www.football-data.org) (Primeira Liga + European cups) and [api-sports.io](https://dashboard.api-football.com) (Taça de Portugal + Taça da Liga). Both have free tiers.

Each date is stored with its competition (`CL`, `PPL`, `EL`, `UECL`, `TP`, `TL`), which is what lets the calendar's alert say *Porto foi o único a jogar Champions League e não foi manchete em todas as capas* instead of just naming the club. A club playing two competitions on one day can't happen, but the same fixture arrives from both sources, so the European code wins over the domestic one rather than whichever import ran last. Rows imported before this column read as `NULL` and drop the competition from the sentence until that season is re-imported.

With no season argument it imports the season happening now (August to June).

The **Import Match Dates** GitHub Action runs this every Monday, and can be triggered by hand: pass a season year, leave it blank for the current one, or tick "list leagues" to print api-sports.io's Portuguese league IDs instead of importing anything. The weekly run matters because fixtures arrive all season — the Champions League league phase is drawn in late August and the knockout rounds from February. A European fixture missing from `matches` shows up on the dashboard as a 🚨 against papers that led with a club that did play. See [Scraping](#scraping) for the rest of the one-click workflows.
