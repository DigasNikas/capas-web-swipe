#!/usr/bin/env python3
"""
import_matches.py — Fetch match dates for Sporting CP, SL Benfica, FC Porto
across all competitions and insert into the D1 matches table via wrangler.

Data sources (both free, no credit card):
  football-data.org   →  PPL, Champions League, Europa League, Conference League
  api-sports.io       →  Taça de Portugal, Taça da Liga
                         (register at https://dashboard.api-football.com/register)

Requirements:
  1. FOOTBALL_API_KEY  — https://www.football-data.org/client/register
  2. APISPORTS_KEY     — https://dashboard.api-football.com/register  (optional)
  3. wrangler installed and authenticated

Usage:
  FOOTBALL_API_KEY=key python3 import_matches.py                  # 2024-25
  FOOTBALL_API_KEY=key APISPORTS_KEY=key2 python3 import_matches.py 2023
"""

import os
import sys
import json
import subprocess
import urllib.request
import urllib.error

FOOTBALL_API_KEY = os.environ.get("FOOTBALL_API_KEY", "")
APISPORTS_KEY    = os.environ.get("APISPORTS_KEY", "")
SEASON           = sys.argv[1] if len(sys.argv) > 1 else "2024"
DB_NAME          = "capas-db"

# ── football-data.org competitions (free tier) ─────────────────────────────
FOOTBALL_DATA_COMPETITIONS = [
    ("PPL",  "Primeira Liga"),
    ("CL",   "Champions League"),
    ("EL",   "Europa League"),
    ("UECL", "Conference League"),
]

# ── api-sports.io competitions ─────────────────────────────────────────────
APISPORTS_COMPETITIONS = [
    (96, "Taça de Portugal"),
    (95, "Taça da Liga"),
]

# ── Team name → slug mapping ────────────────────────────────────────────────
TEAM_MAP = {
    # football-data.org names
    "Sporting CP":            "sporting",
    "Sport Lisboa e Benfica": "benfica",
    "SL Benfica":             "benfica",
    "FC Porto":               "porto",
    # api-sports.io names (may differ slightly)
    "Sporting CP":            "sporting",
    "Benfica":                "benfica",
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


def fetch_apisports(league_id):
    url = f"https://v3.football.api-sports.io/fixtures?league={league_id}&season={SEASON}"
    req = urllib.request.Request(url, headers={"x-apisports-key": APISPORTS_KEY})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
        return data.get("response", [])


def slug_for(name):
    return TEAM_MAP.get(name)


def main():
    if not FOOTBALL_API_KEY:
        print("Error: set FOOTBALL_API_KEY.")
        print("  Register free at https://www.football-data.org/client/register")
        sys.exit(1)

    rows = set()

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
        for m in matches:
            date = m["utcDate"][:10]
            for side in ("homeTeam", "awayTeam"):
                s = slug_for(m[side]["name"])
                if s:
                    rows.add((s, date))
        print(f"{len(rows) - before} new rows  ({len(matches)} matches total)")

    # ── api-sports.io (Portuguese cups) ───────────────────────────────────
    if APISPORTS_KEY:
        for league_id, label in APISPORTS_COMPETITIONS:
            print(f"  [{label}]", end=" ", flush=True)
            try:
                fixtures = fetch_apisports(league_id)
            except urllib.error.HTTPError as e:
                print(f"skipped ({e.code})")
                continue
            before = len(rows)
            for f in fixtures:
                date = f["fixture"]["date"][:10]
                for side in ("home", "away"):
                    s = slug_for(f["teams"][side]["name"])
                    if s:
                        rows.add((s, date))
            print(f"{len(rows) - before} new rows  ({len(fixtures)} fixtures total)")
    else:
        print("\n  Taça de Portugal and Taça da Liga skipped.")
        print("  Set APISPORTS_KEY to include them.")
        print("  Register free at https://dashboard.api-football.com/register")

    if not rows:
        print("\nNo rows collected — nothing to insert.")
        sys.exit(1)

    rows = sorted(rows, key=lambda r: (r[1], r[0]))
    print(f"\nInserting {len(rows)} rows into D1 …")

    values = ", ".join(f"('{s}', '{d}')" for s, d in rows)
    sql    = f"INSERT OR IGNORE INTO matches (club, match_date) VALUES {values};"

    result = subprocess.run(
        ["wrangler", "d1", "execute", DB_NAME, "--command", sql],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print("wrangler error:\n" + result.stderr)
        sys.exit(1)

    print(f"Done — {len(rows)} rows inserted (duplicates skipped).")


if __name__ == "__main__":
    main()
