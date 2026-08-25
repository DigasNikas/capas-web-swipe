# Match dates

The calendar highlights days after a match to make it easier to find covers that might feature a club's result. Match dates are imported manually into D1:

```bash
FOOTBALL_API_KEY=<key> APISPORTS_KEY=<key> python3 scripts/import_matches.py
```

Data sources: [football-data.org](https://www.football-data.org) (Primeira Liga + European cups) and [api-sports.io](https://dashboard.api-football.com) (Taça de Portugal + Taça da Liga). Both have free tiers.

Or trigger the **Import Match Dates** GitHub Action instead of running it locally — pass a season year, or tick "list leagues" to print api-sports.io's Portuguese league IDs instead of importing anything. See [Scraping](#scraping) for the rest of the one-click workflows.
