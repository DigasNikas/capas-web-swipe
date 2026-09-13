#!/usr/bin/env python3
"""
import_matches.py — Fetch match dates for Sporting CP, SL Benfica, FC Porto
across all competitions and insert into the D1 matches table via wrangler.

Data sources (all free, no credit card):
  football-data.org   →  Primeira Liga, Champions League
  match.uefa.com      →  Champions League, Europa League, Conference League,
                         qualifying rounds included. No key. The free
                         football-data tier serves neither EL nor UECL.
  ligaportugal.pt     →  Taça da Liga (no key; the site's own API)
  api-sports.io       →  Taça de Portugal, Taça da Liga, but only up to the
                         2024-25 season on the free plan
                         (register at https://dashboard.api-football.com/register)

The competition code is stored with each date, so the dashboard's alert can
name it.

Requirements:
  1. FOOTBALL_API_KEY  — https://www.football-data.org/client/register
  2. APISPORTS_KEY     — https://dashboard.api-football.com/register  (optional)
  3. wrangler installed and authenticated

Usage:
  FOOTBALL_API_KEY=key python3 import_matches.py                  # current season
  FOOTBALL_API_KEY=key APISPORTS_KEY=key2 python3 import_matches.py 2023

  # List all Portuguese league IDs from api-sports.io (to find correct IDs):
  APISPORTS_KEY=key2 python3 import_matches.py --list-leagues
"""

import datetime
import os
import sys
import json
import subprocess
import urllib.request
import urllib.error

FOOTBALL_API_KEY = os.environ.get("FOOTBALL_API_KEY", "")
APISPORTS_KEY    = os.environ.get("APISPORTS_KEY", "")


def current_season(today=None):
    """The year an Aug-Jun season starts in, which is how both APIs label it.

    July counts as the new season: no matches yet, but the fixtures are out.
    """
    d = today or datetime.date.today()
    return str(d.year if d.month >= 7 else d.year - 1)


# No season argument means the one happening now. It used to mean 2024.
_args            = [a for a in sys.argv[1:] if a and not a.startswith("--")]
SEASON           = _args[0] if _args else current_season()
DB_NAME          = "capas-db"
# match.uefa.com answers 403 to urllib's default User-Agent.
UEFA_UA          = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) capas-import-matches/1.0"

# ── football-data.org competitions (free tier) ─────────────────────────────
# The Europa and Conference Leagues used to be listed here and answered 403
# and 404: neither is on the free tier. They come from UEFA below instead.
FOOTBALL_DATA_COMPETITIONS = [
    ("PPL",  "Primeira Liga"),
    ("CL",   "Champions League"),
]

# ── UEFA's own match feed ──────────────────────────────────────────────────
# No key, no plan, and it includes the July/August qualifying rounds that the
# competition feeds skip. Champions League is here too, redundantly with
# football-data above, so one source going quiet doesn't lose a European night.
# (competition id, code stored in D1, label)
UEFA_COMPETITIONS = [
    (1,    "CL",   "Champions League (UEFA)"),
    (14,   "EL",   "Europa League"),
    (2019, "UECL", "Conference League"),
]

# ── Liga Portugal's own API ────────────────────────────────────────────────
# The Taça da Liga, which no free tier anywhere else covers for the current
# season. Same API the ligaportugal.pt site calls, no key. Rounds appear as
# they are drawn, so the round list is read first rather than guessed.
LIGA_PT_COMPETITIONS = [
    ("allianzcup", "TL", "Taça da Liga"),
]

# ── api-sports.io competitions ─────────────────────────────────────────────
# (league id, competition code stored in D1, label)
APISPORTS_COMPETITIONS = [
    (94, "PPL", "Primeira Liga"),
    (96, "TP",  "Taça de Portugal"),
    (97, "TL",  "Taça da Liga"),
]

# Most worth naming in the dashboard's alert first. A club plays once a day,
# but the same fixture arrives from both sources, so the winner can't be
# whichever loop ran last.
COMPETITION_PRIORITY = ["CL", "EL", "UECL", "TP", "TL", "PPL"]


def stale_delete_sql(season, fetched_codes, keys):
    """SQL removing fixtures this import no longer sees, or None to skip.

    Fixtures get moved — a league game slides from Saturday to Sunday for TV —
    and an import that only ever adds leaves the old date behind for good. The
    dashboard then reads the ghost as a club having played that night.

    Only rows inside the season, and only in competitions this run actually
    fetched, are deleted; a competition whose source failed keeps everything it
    has. Rows with no competition are legacy (they predate that column) and go
    the same way, since every source that could have written them has just been
    re-read. If the league itself failed to fetch, nothing is deleted at all:
    the run has no idea what the current fixture list looks like.
    """
    if "PPL" not in fetched_codes:
        return None

    start, end = f"{season}-07-01", f"{int(season) + 1}-06-30"
    codes = ", ".join(f"'{c}'" for c in sorted(fetched_codes))
    kept = ", ".join(sorted(f"'{club}|{date}'" for club, date in keys)) or "''"
    return (
        f"DELETE FROM matches WHERE match_date BETWEEN '{start}' AND '{end}' "
        f"AND (competition IN ({codes}) OR competition IS NULL) "
        f"AND club || '|' || match_date NOT IN ({kept});\n"
    )


def keep_competition(existing, new):
    """Which of two competition codes to store for one club on one day."""
    if existing is None:
        return new
    rank = lambda c: COMPETITION_PRIORITY.index(c) if c in COMPETITION_PRIORITY else len(COMPETITION_PRIORITY)
    return min(existing, new, key=rank)

# ── Team name → slug mapping ────────────────────────────────────────────────
TEAM_MAP = {
    "Sporting CP":                  "sporting",
    "Sporting":                     "sporting",
    "Sporting Clube de Portugal":   "sporting",
    "Sport Lisboa e Benfica":       "benfica",
    "SL Benfica":             "benfica",
    "Benfica":                "benfica",
    "FC Porto":               "porto",
    "Porto":                  "porto",
}


def fetch_football_data(competition):
    url = (
        f"https://api.football-data.org/v4/competitions/{competition}"
        f"/matches?season={SEASON}"
    )
    req = urllib.request.Request(url, headers={"X-Auth-Token": FOOTBALL_API_KEY})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())["matches"]


def uefa_pairs(matches):
    """(team name, YYYY-MM-DD) for both sides of every scheduled match.

    A drawn-but-unscheduled tie has no kickOffTime, and no date to store.
    """
    pairs = []
    for m in matches:
        kick = m.get("kickOffTime") or {}
        date = (kick.get("dateTime") or "")[:10]
        if not date:
            continue
        for side in ("homeTeam", "awayTeam"):
            name = (m.get(side) or {}).get("internationalName")
            if name:
                pairs.append((name, date))
    return pairs


def fetch_uefa(competition_id):
    """Every match of one UEFA competition in SEASON, paged.

    seasonYear is the year the season *ends* in: 2026-27 is 2027.
    """
    out, offset, page = [], 0, 200
    while True:
        url = (
            f"https://match.uefa.com/v5/matches?competitionId={competition_id}"
            f"&seasonYear={int(SEASON) + 1}&limit={page}&offset={offset}"
        )
        req = urllib.request.Request(url, headers={"User-Agent": UEFA_UA})
        with urllib.request.urlopen(req, timeout=20) as resp:
            batch = json.loads(resp.read())
        out.extend(batch)
        if len(batch) < page:
            return out
        offset += page


def liga_pairs(matches):
    """(team name, YYYY-MM-DD) for both sides of every match in one round.

    A round that exists but hasn't been drawn answers with an error object
    instead of a list.
    """
    if not isinstance(matches, list):
        return []
    pairs = []
    for m in matches:
        date = (m.get("matchDate") or "")[:10]
        if not date:
            continue
        for side in ("homeTeam", "awayTeam"):
            name = (m.get(side) or {}).get("name")
            if name:
                pairs.append((name, date))
    return pairs


def fetch_liga_pt(competition):
    """Every drawn round of one Liga Portugal competition in SEASON."""
    season = f"{SEASON}{int(SEASON) + 1}"
    base = "https://www.ligaportugal.pt/api/v1/competition"

    def get(url):
        req = urllib.request.Request(url, headers={"User-Agent": UEFA_UA})
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read())

    rounds = get(f"{base}/season/rounds?competition={competition}&season={season}")
    out = []
    for r in rounds if isinstance(rounds, list) else []:
        out.extend(liga_pairs(get(
            f"{base}/matches?competition={competition}&season={season}&round={r['round_number']}"
        )))
    return out


def fetch_apisports(league_id):
    url = f"https://v3.football.api-sports.io/fixtures?league={league_id}&season={SEASON}"
    req = urllib.request.Request(url, headers={"x-apisports-key": APISPORTS_KEY})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
        return data.get("response", [])


def slug_for(name):
    return TEAM_MAP.get(name)


def list_portuguese_leagues():
    if not APISPORTS_KEY:
        print("Error: set APISPORTS_KEY.")
        sys.exit(1)
    url = "https://v3.football.api-sports.io/leagues?country=Portugal"
    req = urllib.request.Request(url, headers={"x-apisports-key": APISPORTS_KEY})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    leagues = data.get("response", [])
    print(f"{'ID':<8} {'Type':<12} Name")
    print("-" * 45)
    for entry in sorted(leagues, key=lambda e: e["league"]["id"]):
        lg = entry["league"]
        print(f"{lg['id']:<8} {lg['type']:<12} {lg['name']}")


def main():
    if "--list-leagues" in sys.argv:
        list_portuguese_leagues()
        return

    if not FOOTBALL_API_KEY:
        print("Error: set FOOTBALL_API_KEY.")
        print("  Register free at https://www.football-data.org/client/register")
        sys.exit(1)

    rows = {}   # (club, date) -> competition code
    fetched = set()   # competition codes whose source answered this run

    # ── football-data.org ──────────────────────────────────────────────────
    print(f"Season {SEASON}-{int(SEASON)+1}\n")
    for code, label in FOOTBALL_DATA_COMPETITIONS:
        print(f"  [{label}]", end=" ", flush=True)
        try:
            matches = fetch_football_data(code)
        except urllib.error.HTTPError as e:
            print(f"skipped ({e.code})")
            continue
        before = len(rows)
        unknown = set()
        for m in matches:
            date = m["utcDate"][:10]
            for side in ("homeTeam", "awayTeam"):
                name = m[side]["name"]
                if not name:
                    continue
                s = slug_for(name)
                if s:
                    rows[(s, date)] = keep_competition(rows.get((s, date)), code)
                else:
                    unknown.add(name)
        fetched.add(code)
        added = len(rows) - before
        print(f"{added} new rows  ({len(matches)} matches total)")
        if unknown:
            print(f"    ↳ unrecognised team names (add to TEAM_MAP if needed):")
            for n in sorted(unknown):
                print(f"       {n!r}")

    # ── UEFA ───────────────────────────────────────────────────────────────
    for comp_id, code, label in UEFA_COMPETITIONS:
        print(f"  [{label}]", end=" ", flush=True)
        try:
            matches = fetch_uefa(comp_id)
        except (urllib.error.HTTPError, urllib.error.URLError) as e:
            print(f"skipped ({e})")
            continue
        fetched.add(code)
        before = len(rows)
        for name, date in uefa_pairs(matches):
            s = slug_for(name)
            if s:
                rows[(s, date)] = keep_competition(rows.get((s, date)), code)
        added = len(rows) - before
        print(f"{added} new rows  ({len(matches)} matches total)")

    # ── Liga Portugal ──────────────────────────────────────────────────────
    for competition, code, label in LIGA_PT_COMPETITIONS:
        print(f"  [{label}]", end=" ", flush=True)
        try:
            pairs = fetch_liga_pt(competition)
        except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError) as e:
            print(f"skipped ({e})")
            continue
        fetched.add(code)
        before = len(rows)
        for name, date in pairs:
            s = slug_for(name)
            if s:
                rows[(s, date)] = keep_competition(rows.get((s, date)), code)
        added = len(rows) - before
        print(f"{added} new rows  ({len(pairs) // 2} matches total)")

    # ── api-sports.io ──────────────────────────────────────────────────────
    if APISPORTS_KEY:
        for league_id, code, label in APISPORTS_COMPETITIONS:
            print(f"  [{label}]", end=" ", flush=True)
            try:
                fixtures = fetch_apisports(league_id)
            except urllib.error.HTTPError as e:
                print(f"skipped ({e.code})")
                continue
            before = len(rows)
            unknown = set()
            for f in fixtures:
                date = f["fixture"]["date"][:10]
                for side in ("home", "away"):
                    name = f["teams"][side]["name"]
                    if not name:
                        continue
                    s = slug_for(name)
                    if s:
                        rows[(s, date)] = keep_competition(rows.get((s, date)), code)
                    else:
                        unknown.add(name)
            fetched.add(code)
            added = len(rows) - before
            print(f"{added} new rows  ({len(fixtures)} fixtures total)")
            if unknown:
                print(f"    ↳ unrecognised team names (add to TEAM_MAP if needed):")
                for n in sorted(unknown):
                    print(f"       {n!r}")
    else:
        print("\n  api-sports.io competitions skipped (Primeira Liga, Taça de Portugal, Taça da Liga).")
        print("  Set APISPORTS_KEY to include them.")
        print("  Register free at https://dashboard.api-football.com/register")

    if not rows:
        print("\nNo rows collected — nothing to insert.")
        sys.exit(1)

    rows = sorted(rows.items(), key=lambda kv: (kv[0][1], kv[0][0]))
    by_club = {}
    for (s, d), c in rows:
        by_club.setdefault(s, 0)
        by_club[s] += 1
    print("\nRows per club:")
    for club, cnt in sorted(by_club.items()):
        print(f"  {club}: {cnt}")
    print(f"\nInserting {len(rows)} rows into D1 …")

    # Upsert rather than INSERT OR IGNORE: a re-import backfills `competition`
    # on rows inserted before that column existed.
    values = ", ".join(f"('{s}', '{d}', '{c}')" for (s, d), c in rows)
    sql    = (
        f"INSERT INTO matches (club, match_date, competition) VALUES {values} "
        f"ON CONFLICT (club, match_date) DO UPDATE SET competition = excluded.competition;\n"
    )
    stale = stale_delete_sql(SEASON, fetched, {k for k, _ in rows})
    if stale:
        sql += stale
        print("Removing fixtures that moved or were cancelled since the last import.")

    import tempfile, os
    with tempfile.NamedTemporaryFile(mode="w", suffix=".sql", delete=False) as f:
        f.write(sql)
        tmp = f.name

    try:
        result = subprocess.run(
            ["wrangler", "d1", "execute", DB_NAME, "--remote", "--file", tmp],
            capture_output=True, text=True,
        )
    finally:
        os.unlink(tmp)

    if result.returncode != 0:
        print("wrangler error:\n" + result.stderr)
        sys.exit(1)

    print(f"Done — {len(rows)} rows inserted or updated.")


if __name__ == "__main__":
    main()
