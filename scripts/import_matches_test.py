#!/usr/bin/env python3
"""Self-check for the season default: python3 scripts/import_matches_test.py

Run without arguments, the import has to mean "the season happening now".
It used to default to a hardcoded 2024, so a scheduled run imported a
two-year-old season and silently changed nothing.
"""
import datetime

from import_matches import current_season, keep_competition

# A season is labelled by the year it starts in: 2026 means 2026-27.
assert current_season(datetime.date(2026, 9, 12)) == "2026", "mid-season"
assert current_season(datetime.date(2027, 5, 16)) == "2026", "spring belongs to the season that started last August"
assert current_season(datetime.date(2026, 6, 30)) == "2025", "June is still last season"
# July has no matches but does have next season's published fixtures.
assert current_season(datetime.date(2026, 7, 1)) == "2026"
assert current_season(datetime.date(2026, 8, 8)) == "2026"

# A club plays one match a day, but the same date arrives from more than one
# source (api-sports also serves the Primeira Liga). Keep the competition the
# alert most wants to name, and never let source order decide it.
assert keep_competition(None, "PPL") == "PPL"
assert keep_competition("PPL", "CL") == "CL", "European night beats a league fixture"
assert keep_competition("CL", "PPL") == "CL", "and does so whichever arrives first"
assert keep_competition("TP", "TL") == "TP"
assert keep_competition("PPL", "PPL") == "PPL"

print("import_matches.py self-check ok")
