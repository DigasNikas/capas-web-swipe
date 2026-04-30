#!/usr/bin/env python3
"""
import_matches.py — Fetch Primeira Liga match dates from football-data.org
and insert them into the D1 matches table via wrangler.

Requirements:
  1. Free API key from https://www.football-data.org/client/register
     (no credit card — just an email address)
  2. wrangler installed and authenticated

Usage:
  FOOTBALL_API_KEY=your_key python3 import_matches.py           # 2024-25 season
  FOOTBALL_API_KEY=your_key python3 import_matches.py 2023      # 2023-24 season
"""

import os
import sys
import json
import subprocess
import urllib.request

API_KEY  = os.environ.get("FOOTBALL_API_KEY", "")
SEASON   = sys.argv[1] if len(sys.argv) > 1 else "2024"
DB_NAME  = "capas-db"

# football-data.org team names → our slugs
TEAM_MAP = {
    "Sporting CP":               "sporting",
    "Sport Lisboa e Benfica":    "benfica",
    "SL Benfica":                "benfica",
    "FC Porto":                  "porto",
}

def fetch_matches():
    url = f"https://api.football-data.org/v4/competitions/PPL/matches?season={SEASON}"
    req = urllib.request.Request(url, headers={"X-Auth-Token": API_KEY})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())["matches"]

def slug_for(team_name):
    return TEAM_MAP.get(team_name)

def main():
    if not API_KEY:
        print("Error: set FOOTBALL_API_KEY env var.")
        print("  Register free at https://www.football-data.org/client/register")
        sys.exit(1)

    print(f"Fetching Liga Portugal {SEASON}-{int(SEASON)+1} matches …")
    matches = fetch_matches()
    print(f"  {len(matches)} total matches returned")

    rows = set()
    for m in matches:
        date = m["utcDate"][:10]   # 'YYYY-MM-DD'
        for side in ("homeTeam", "awayTeam"):
            slug = slug_for(m[side]["name"])
            if slug:
                rows.add((slug, date))

    if not rows:
        print("No matches found for Sporting / Benfica / Porto.")
        sys.exit(1)

    rows = sorted(rows, key=lambda r: (r[1], r[0]))
    print(f"  {len(rows)} rows for Sporting / Benfica / Porto\n")

    values = ", ".join(f"('{slug}', '{date}')" for slug, date in rows)
    sql    = f"INSERT OR IGNORE INTO matches (club, match_date) VALUES {values};"

    print("Running: wrangler d1 execute …")
    result = subprocess.run(
        ["wrangler", "d1", "execute", DB_NAME, "--command", sql],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print("wrangler error:")
        print(result.stderr)
        sys.exit(1)

    print(f"Done — {len(rows)} rows inserted.")

if __name__ == "__main__":
    main()
