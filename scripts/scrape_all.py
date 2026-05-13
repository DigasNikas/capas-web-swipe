#!/usr/bin/env python3
"""
scrape_all.py — Run all three newspaper scrapers.

Usage:
  python3 scrape_all.py 7          # last 7 days
  python3 scrape_all.py 7 --debug
"""

import sys
import os
import subprocess

args = [a for a in sys.argv[1:] if not a.startswith("--")]
if not args:
    print("Usage: python3 scrape_all.py <days> [--debug]")
    sys.exit(1)

flags = [a for a in sys.argv[1:] if a.startswith("--")]
here = os.path.dirname(os.path.abspath(__file__))

for script in ("scrape_record.py", "scrape_abola.py", "scrape_ojogo.py"):
    print(f"\n{'─' * 40}")
    print(f"  {script}")
    print(f"{'─' * 40}")
    subprocess.run([sys.executable, os.path.join(here, script)] + sys.argv[1:], check=False)
