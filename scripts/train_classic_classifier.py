#!/usr/bin/env python3
"""Classic-ML exercise, not a production model: flatten each cover into a
pixel vector, fit a linear classifier (logistic regression) on the crowd's
own votes, and see how a from-scratch baseline — no pretraining, no OCR,
no transfer learning — does against covers it never trained on.

Not meant to compete with the zero-shot AI Detector (documentation#ai-detector)
or its 77% archive-wide agreement; the point here is the exercise itself,
same "flatten it, fit a linear model, check accuracy/recall" shape as an
intro ML course's first pass before reaching for anything smarter.

    python3 -m venv .venv && .venv/bin/pip install numpy pillow scikit-learn
    .venv/bin/python scripts/train_classic_classifier.py
    .venv/bin/python scripts/train_classic_classifier.py --limit 200   # quick run
"""
import argparse
import io
import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix

STATS = "https://capas.digasnikas.com/api/stats"
# Cloudflare 403s the default urllib User-Agent — same fix as avg_cover.py.
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) capas-classic-classifier/1.0"
SIZE = 32  # each cover shrinks to SIZE x SIZE before flattening
CLUBS = ("sporting", "benfica", "porto", "others")


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


def vectorize(url):
    """One cover -> a flat SIZE*SIZE*3 pixel vector, values in [0, 1]. This
    is the whole "feature engineering" step — no crops, no color histograms,
    no hand-built features, just the shrunk image read as a flat number
    list, the classic starting point before anything fancier."""
    raw = fetch(url)
    if raw is None:
        return None
    img = Image.open(io.BytesIO(raw)).convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
    return (np.asarray(img, np.float32) / 255.0).flatten()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, help="use only the N most recent labelled covers (faster iteration)")
    args = ap.parse_args()

    rows = json.loads(fetch(STATS))["rows"]
    rows = [r for r in rows if r["club"] in CLUBS]
    rows.sort(key=lambda r: r["date"])  # chronological order, for the split below
    if args.limit:
        rows = rows[-args.limit:]
    print(f"{len(rows)} labelled covers")

    with ThreadPoolExecutor(12) as pool:
        vectors = list(pool.map(lambda r: vectorize(r["url"]), rows))

    kept = [(v, r["club"]) for v, r in zip(vectors, rows) if v is not None]
    print(f"{len(kept)} vectorized ({len(rows) - len(kept)} failed to download)")

    X = np.stack([v for v, _ in kept])
    y = np.array([c for _, c in kept])

    # Chronological split — train on the older 80%, test on the most recent
    # 20% — rather than a random one: covers share a masthead template
    # within a stretch of dates, so a random split would let near-duplicate
    # examples leak between train and test and inflate the score. This is
    # also the honest version of the real question, "can this predict a
    # cover it's never seen," since training only ever sees the past.
    split = int(len(X) * 0.8)
    X_train, X_test = X[:split], X[split:]
    y_train, y_test = y[:split], y[split:]
    print(f"train={len(X_train)}  test={len(X_test)}")

    clf = LogisticRegression(max_iter=1000)
    clf.fit(X_train, y_train)

    pred = clf.predict(X_test)
    print(f"\naccuracy  {accuracy_score(y_test, pred):.1%}")
    print(classification_report(y_test, pred, labels=CLUBS, zero_division=0))

    print("confusion matrix (rows: true, cols: predicted)")
    cm = confusion_matrix(y_test, pred, labels=CLUBS)
    print(f"{'':10}" + "".join(f"{c[:6]:>8}" for c in CLUBS))
    for label, row in zip(CLUBS, cm):
        print(f"{label:10}" + "".join(f"{n:8d}" for n in row))


if __name__ == "__main__":
    main()
