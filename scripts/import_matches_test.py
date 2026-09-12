#!/usr/bin/env python3
"""Self-check for the season default: python3 scripts/import_matches_test.py

Run without arguments, the import has to mean "the season happening now".
It used to default to a hardcoded 2024, so a scheduled run imported a
two-year-old season and silently changed nothing.
"""
import datetime

from import_matches import current_season

# A season is labelled by the year it starts in: 2026 means 2026-27.
assert current_season(datetime.date(2026, 9, 12)) == "2026", "mid-season"
assert current_season(datetime.date(2027, 5, 16)) == "2026", "spring belongs to the season that started last August"
assert current_season(datetime.date(2026, 6, 30)) == "2025", "June is still last season"
# July has no matches but does have next season's published fixtures.
assert current_season(datetime.date(2026, 7, 1)) == "2026"
assert current_season(datetime.date(2026, 8, 8)) == "2026"

print("import_matches.py self-check ok")
