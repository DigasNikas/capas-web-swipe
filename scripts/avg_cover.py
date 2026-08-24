#!/usr/bin/env python3
"""A capa média — pixel-wise mean of every cover, per newspaper and per
newspaper+club.

The masthead is in the same place on every edition so it survives the average
razor sharp; the headlines move around and dissolve into a ghost. That is what
each paper looks like with the individual days averaged out.

Runs locally, not in the Worker: it downloads ~1250 full-res JPEGs. Output goes
to landing/avg/ and is committed, so the page needs no backend for this.

    python3 -m venv .venv && .venv/bin/pip install numpy pillow
    .venv/bin/python scripts/avg_cover.py
"""
import io
import json
import os
import sys
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

STATS = "https://capas.digasnikas.com/api/stats"
OUT = os.path.join(os.path.dirname(__file__), "..", "landing", "avg")
PAPERS = ("abola", "ojogo", "record")
CLUBS = ("benfica", "porto", "sporting", "others")

W = 620          # every cover is scaled to this width, aspect preserved
CH = 1000        # canvas the covers are stacked into
TOP = 120        # where the reference cover starts, leaving room to shift up
MAX_SHIFT = 250  # further off than this and the match is noise, not alignment

# Cloudflare 403s the default urllib User-Agent, so send a real-looking one.
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) capas-avg-cover/1.0"


def fetch(url, tries=3):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception as e:
            if i == tries - 1:
                print(f"  skip {url}: {e}", file=sys.stderr)
                return None


def load(url):
    """One cover, scaled to width W with its own aspect, as float32 HxWx3."""
    raw = fetch(url)
    if raw is None:
        return None
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    return np.asarray(img.resize((W, round(img.height * W / img.width)), Image.LANCZOS), np.float32)


def profile(arr):
    """Mean brightness per row, zero-centred: a 1D fingerprint of the page's
    horizontal bands (masthead, rules, ad strips)."""
    p = arr.mean(axis=(1, 2))
    return p - p.mean()


def align(arr, ref):
    """Row offset that lines this cover's bands up with the reference profile.

    The archive spans two scrapes: the older one keeps an advertising strip
    above the masthead, the newer one crops it off, so the same masthead sits
    ~70px apart. Averaging without this prints every masthead twice.
    """
    lag = int(np.argmax(np.correlate(ref, profile(arr), "full"))) - (len(arr) - 1)
    return lag if abs(lag) <= MAX_SHIFT else 0


def add(sums, counts, key, arr, top):
    """Accumulate one cover into one bucket, tracking per-pixel coverage so the
    rows only some covers reach aren't averaged against black."""
    if key not in sums:
        sums[key] = np.zeros((CH, W, 3), np.float32)
        counts[key] = np.zeros((CH, 1, 1), np.float32)
    a, b = max(top, 0), min(top + len(arr), CH)
    if b > a:
        sums[key][a:b] += arr[a - top:b - top]
        counts[key][a:b] += 1


def main():
    rows = json.loads(fetch(STATS))["rows"]
    rows = [r for r in rows if r["newspaper"] in PAPERS and r["club"] in CLUBS]
    print(f"{len(rows)} covers")

    # One reference per paper: its newest cover. Alignment is relative, so any
    # single cover would do — this one just keeps the current crop centred.
    refs = {}
    for paper in PAPERS:
        newest = max((r for r in rows if r["newspaper"] == paper), key=lambda r: r["date"])
        refs[paper] = profile(load(newest["url"]))

    sums, counts, n = {}, {}, defaultdict(int)
    done = 0
    with ThreadPoolExecutor(12) as pool:
        for row, arr in pool.map(lambda r: (r, load(r["url"])), rows):
            if arr is None:
                continue
            top = TOP + align(arr, refs[row["newspaper"]])
            for key in (row["newspaper"], f'{row["newspaper"]}-{row["club"]}'):
                add(sums, counts, key, arr, top)
                n[key] += 1
            done += 1
            if done % 100 == 0:
                print(f"  {done}/{len(rows)}")

    os.makedirs(OUT, exist_ok=True)
    for key in sorted(sums):
        cov = counts[key]
        # Trim the rows only a handful of covers reach, or the top and bottom
        # edges are the average of three pages instead of four hundred.
        keep = np.where(cov[:, 0, 0] >= 0.5 * cov.max())[0]
        mean = (sums[key][keep] / np.maximum(cov[keep], 1)).round().clip(0, 255).astype(np.uint8)
        path = os.path.join(OUT, f"{key}.jpg")
        Image.fromarray(mean).save(path, quality=88, optimize=True)
        print(f"{key}: {n[key]} covers -> {os.path.relpath(path)} {mean.shape[1]}x{mean.shape[0]}")

    # The page prints "média de N capas" under each image, so the counts ship
    # with them rather than being hard-coded into the markup.
    with open(os.path.join(OUT, "counts.json"), "w") as f:
        json.dump(dict(n), f, indent=0, sort_keys=True)


if __name__ == "__main__":
    main()
