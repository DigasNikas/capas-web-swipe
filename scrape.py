#!/usr/bin/env python3
"""
scrape.py — Download today's front pages from sapo.pt/noticias/jornais/desporto
Saves images to ./images/ named like:  abola_2026-03-15.jpg
Updates images/manifest.json with current filenames.

Usage:
  python3 scrape.py            # download today
  python3 scrape.py --debug    # dump HTML to debug.html and print found images
"""

import os
import sys
import json
import re
import datetime
import urllib.request
import urllib.parse
import html.parser

URL   = "https://sapo.pt/noticias/jornais/desporto"
DEST  = os.path.join(os.path.dirname(__file__), "images")
DEBUG = "--debug" in sys.argv

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8",
    "Referer": "https://sapo.pt/",
}

# Map newspaper name (as it appears on the page) → slug used in filenames
NEWSPAPERS = {
    "a bola":  "abola",
    "o jogo":  "ojogo",
    "record":  "record",
}

# ── Fetch ──────────────────────────────────────────────────────────────────
def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8", errors="replace")

# ── Simple HTML parser to extract img tags with surrounding text ───────────
class ImageFinder(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.results  = []   # list of (text_context, src)
        self._context = []   # recent text nodes
        self._in_a    = False

    def handle_starttag(self, tag, attrs):
        if tag == "img":
            attrs = dict(attrs)
            src = attrs.get("src") or attrs.get("data-src") or attrs.get("data-lazy-src") or ""
            alt = attrs.get("alt", "")
            ctx = " ".join(self._context[-5:]) + " " + alt
            self.results.append((ctx.strip(), src))

    def handle_data(self, data):
        t = data.strip()
        if t:
            self._context.append(t)
            if len(self._context) > 20:
                self._context.pop(0)

# ── Match images to newspapers ─────────────────────────────────────────────
def find_newspaper_images(html_text):
    finder = ImageFinder()
    finder.feed(html_text)

    matches = {}   # slug → src

    # First pass: look for images whose context contains the newspaper name
    for ctx, src in finder.results:
        if not src or not src.startswith("http"):
            continue
        ctx_lower = ctx.lower()
        for name, slug in NEWSPAPERS.items():
            if slug in matches:
                continue
            if name in ctx_lower:
                matches[slug] = src
                if DEBUG:
                    print(f"[match] {slug} — context: {ctx!r}\n        src: {src}")

    # Second pass: try to match by URL pattern if any newspaper name is in the URL
    if len(matches) < len(NEWSPAPERS):
        for ctx, src in finder.results:
            if not src or not src.startswith("http"):
                continue
            src_lower = src.lower()
            for name, slug in NEWSPAPERS.items():
                if slug in matches:
                    continue
                # e.g. "a-bola", "abola", "ojogo", "o-jogo", "record" in URL
                if slug in src_lower or name.replace(" ", "-") in src_lower:
                    matches[slug] = src
                    if DEBUG:
                        print(f"[url-match] {slug} — src: {src}")

    return matches

# ── Download ───────────────────────────────────────────────────────────────
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

# ── Manifest ───────────────────────────────────────────────────────────────
def update_manifest(new_files):
    manifest_path = os.path.join(DEST, "manifest.json")
    try:
        existing = json.loads(open(manifest_path).read())
    except Exception:
        existing = []

    combined = list(dict.fromkeys(existing + new_files))  # deduplicate, preserve order
    with open(manifest_path, "w") as f:
        json.dump(combined, f, indent=2)
    print(f"manifest.json → {combined}")

# ── Main ───────────────────────────────────────────────────────────────────
def main():
    today = datetime.date.today().isoformat()   # e.g. 2026-03-15
    os.makedirs(DEST, exist_ok=True)

    print(f"Fetching {URL} …")
    try:
        html_text = fetch(URL)
    except Exception as e:
        print(f"ERROR fetching page: {e}")
        sys.exit(1)

    if DEBUG:
        with open("debug.html", "w") as f:
            f.write(html_text)
        print("Page saved to debug.html")

    matches = find_newspaper_images(html_text)

    if not matches:
        print(
            "No newspaper images found automatically.\n"
            "Run with --debug and open debug.html to inspect the page.\n"
            "Then update NEWSPAPERS or the matching logic in this script."
        )
        sys.exit(1)

    saved = []
    for slug, src in matches.items():
        ext = ext_from_url(src)
        filename = f"{slug}_{today}{ext}"
        dest_path = os.path.join(DEST, filename)

        if os.path.exists(dest_path):
            print(f"  {filename} already exists, skipping.")
            saved.append(filename)
            continue

        print(f"  Downloading {slug} → {filename} …")
        try:
            download(src, dest_path)
            saved.append(filename)
            print(f"  ✓ {filename}")
        except Exception as e:
            print(f"  ✗ Failed to download {slug}: {e}")

    missing = [s for s in NEWSPAPERS.values() if s not in matches]
    if missing:
        print(f"\nWARNING: could not find images for: {', '.join(missing)}")
        print("Run with --debug to inspect the page HTML.")

    if saved:
        update_manifest(saved)

if __name__ == "__main__":
    main()
