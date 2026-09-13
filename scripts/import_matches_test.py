#!/usr/bin/env python3
"""Self-check for the season default: python3 scripts/import_matches_test.py

Run without arguments, the import has to mean "the season happening now".
It used to default to a hardcoded 2024, so a scheduled run imported a
two-year-old season and silently changed nothing.
"""
import datetime

from import_matches import current_season, keep_competition, liga_pairs, stale_delete_sql, uefa_pairs

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

# UEFA's own match feed is where the Europa and Conference Leagues come from:
# football-data.org's free tier serves neither. Same shape for both sides of a
# tie, and the kick-off is UTC, like football-data's utcDate.
PAYLOAD = [
    {
        "homeTeam": {"internationalName": "Benfica"},
        "awayTeam": {"internationalName": "Real Betis"},
        "kickOffTime": {"dateTime": "2026-09-16T19:00:00Z"},
    },
    {
        "homeTeam": {"internationalName": "Feyenoord"},
        "awayTeam": {"internationalName": "Porto"},
        "kickOffTime": {"dateTime": "2026-10-22T17:45:00Z"},
    },
]
assert uefa_pairs(PAYLOAD) == [
    ("Benfica", "2026-09-16"), ("Real Betis", "2026-09-16"),
    ("Feyenoord", "2026-10-22"), ("Porto", "2026-10-22"),
]

# A fixture with no kick-off time yet (drawn but unscheduled) has no date to
# store, and must not crash the import or land as a match on a null day.
assert uefa_pairs([{"homeTeam": {"internationalName": "Benfica"},
                    "awayTeam": {"internationalName": "Porto"},
                    "kickOffTime": None}]) == []
assert uefa_pairs([]) == []

# Liga Portugal's own API is the only free source for the Taça da Liga. Its
# rounds are published as they are drawn, and an undrawn round answers with an
# error object rather than a list.
LIGA_ROUND = [
    {"matchDate": "2026-10-28T20:30:00Z",
     "homeTeam": {"name": "FC Porto"}, "awayTeam": {"name": "Académico"}},
    {"matchDate": "2026-10-29T20:45:00Z",
     "homeTeam": {"name": "SL Benfica"}, "awayTeam": {"name": "Gil Vicente FC"}},
]
assert liga_pairs(LIGA_ROUND) == [
    ("FC Porto", "2026-10-28"), ("Académico", "2026-10-28"),
    ("SL Benfica", "2026-10-29"), ("Gil Vicente FC", "2026-10-29"),
]
assert liga_pairs({"error": "not found"}) == [], "an undrawn round is not a crash"
assert liga_pairs([]) == []

# Fixtures move. The import used to only ever add, so a match rescheduled from
# the 12th to the 13th left a row on both dates, and the dashboard read the
# ghost as "everyone played that night".
import sqlite3

def survivors(sql, rows):
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE matches (club TEXT, match_date TEXT, competition TEXT, UNIQUE (club, match_date))")
    db.executemany("INSERT INTO matches (club, match_date, competition) VALUES (?,?,?)", rows)
    if sql:
        db.executescript(sql)
    return sorted(db.execute("SELECT club, match_date, competition FROM matches").fetchall())

STORED = [
    ("porto", "2026-09-12", "PPL"),      # still on the list
    ("benfica", "2026-09-12", None),     # moved to the 13th, imported before the column existed
    ("sporting", "2026-09-12", "PPL"),   # moved to the 13th
    ("benfica", "2026-09-13", "PPL"),
    ("porto", "2026-05-17", "PPL"),      # last season: outside this import's window
    ("benfica", "2026-11-20", "TP"),     # a competition this run could not fetch
]
KEYS = {("porto", "2026-09-12"), ("benfica", "2026-09-13")}

sql = stale_delete_sql("2026", {"PPL", "CL"}, KEYS)
assert survivors(sql, STORED) == [
    ("benfica", "2026-09-13", "PPL"),
    ("benfica", "2026-11-20", "TP"),
    ("porto", "2026-05-17", "PPL"),
    ("porto", "2026-09-12", "PPL"),
], "drops only the ghosts inside the season, in competitions this run refreshed"

# A run where the league fetch failed must not delete anything: it has no idea
# which fixtures are current.
assert stale_delete_sql("2026", {"CL"}, KEYS) is None
assert stale_delete_sql("2026", set(), set()) is None

print("import_matches.py self-check ok")
