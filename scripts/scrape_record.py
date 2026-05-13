#!/usr/bin/env python3
"""
scrape_record.py — Download Record front pages from sapo.pt for the past N days.

Usage:
  python3 scrape_record.py 7          # last 7 days
  python3 scrape_record.py 7 --debug  # also save raw HTML to debug/<date>.html
"""

import os
import re
import sys
import json
import datetime
import urllib.request
import urllib.parse

DEST    = os.path.join(os.path.dirname(__file__), "images")
DEBUG   = "--debug" in sys.argv
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8",
    "Referer": "https://sapo.pt/",
}

SLUG        = "record"
URL_PATTERN = "https://sapo.pt/noticias/jornais/desporto/record-4139/{date}"


def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8", errors="replace")


def extract_cover_image(html):
    # Find the article-newspaper block, then grab the first img inside it
    m = re.search(r'class=["\'][^"\']*article-newspaper[^"\']*["\'].*?<img[^>]+src=["\'](https?://[^"\']+)["\']', html, re.DOTALL)
    if m:
        return m.group(1)
    # Also try data-src (lazy-loaded images)
    m = re.search(r'class=["\'][^"\']*article-newspaper[^"\']*["\'].*?<img[^>]+data-src=["\'](https?://[^"\']+)["\']', html, re.DOTALL)
    if m:
        return m.group(1)
    return None


def download(url, dest_path):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = resp.read()
    with open(dest_path, "wb") as f:
        f.write(data)


def ext_from_url(url):
    path = urllib.parse.urlparse(url).path
    _, ext = os.path.splitext(path)
    return ext.lower() if ext else ".jpg"


def update_manifest(new_files):
    manifest_path = os.path.join(DEST, "manifest.json")
    try:
        existing = json.loads(open(manifest_path).read())
    except Exception:
        existing = []
    combined = list(dict.fromkeys(existing + new_files))
    with open(manifest_path, "w") as f:
        json.dump(combined, f, indent=2)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print("Usage: python3 scrape.py <days> [--debug]")
        print("  e.g. python3 scrape.py 7")
        sys.exit(1)

    try:
        days = int(args[0])
    except ValueError:
        print(f"Error: '{args[0]}' is not a valid number of days.")
        sys.exit(1)

    os.makedirs(DEST, exist_ok=True)
    if DEBUG:
        os.makedirs("debug", exist_ok=True)

    today = datetime.date.today()
    dates = [today - datetime.timedelta(days=i) for i in range(days)]

    saved = []

    for date in dates:
        date_str   = date.strftime("%Y%m%d")     # URL format: 20260425
        date_label = date.isoformat()            # filename:   2026-04-25
        date_dir   = os.path.join(DEST, date.strftime("%Y"), date.strftime("%m"), date.strftime("%d"))
        url        = URL_PATTERN.format(date=date_str)
        filename   = f"{SLUG}_{date_label}.jpg"
        rel_path   = f"{date.strftime('%Y/%m/%d')}/{filename}"
        dest_path  = os.path.join(date_dir, filename)

        if os.path.exists(dest_path):
            print(f"  {rel_path} already exists, skipping.")
            saved.append(rel_path)
            continue

        print(f"  {date_label} — fetching page …", end=" ", flush=True)
        try:
            html = fetch(url)
        except Exception as e:
            print(f"FAILED ({e})")
            continue

        if DEBUG:
            with open(os.path.join("debug", f"{SLUG}_{date_str}.html"), "w") as f:
                f.write(html)

        img_url = extract_cover_image(html)
        if not img_url:
            print("no image found")
            if not DEBUG:
                print(f"    → re-run with --debug and inspect debug/{SLUG}_{date_str}.html")
            continue

        ext = ext_from_url(img_url)
        if ext != ".jpg":
            filename  = f"{SLUG}_{date_label}{ext}"
            rel_path  = f"{date.strftime('%Y/%m/%d')}/{filename}"
            dest_path = os.path.join(date_dir, filename)

        os.makedirs(date_dir, exist_ok=True)
        try:
            download(img_url, dest_path)
            saved.append(rel_path)
            print(f"saved {rel_path}")
        except Exception as e:
            print(f"download failed ({e})")

    if saved:
        update_manifest(saved)
        print(f"\nmanifest.json updated — {len(saved)} file(s) added.")


if __name__ == "__main__":
    main()
