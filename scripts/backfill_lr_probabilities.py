#!/usr/bin/env python3
"""Fill covers.ai_lr_* with out-of-fold logistic-regression probabilities.

The LR is fitted on the crowd's own labels, so scoring a cover with a model
that saw it in training is meaningless -- it reads ~95% right and measures
nothing. Every row written here comes from a model trained only on covers
dated strictly before it: walk forward one month at a time, train on the
past, predict the month, advance. That is also the rolling backtest, so the
numbers printed at the end are the honest ones, not a single lucky split.

Features are the two production embeddings concatenated (512 CLIP + 768 e5),
read straight back out of Vectorize -- the same vectors retrieval compares
against. A cover missing either one is skipped, not guessed: image-only
recall on `others` is 0.32, barely above a coin toss.

Writes nothing itself. It emits SQL for `wrangler d1 execute`, so the run
that computes the numbers and the run that changes the database stay
separate and the SQL is reviewable in between.

    CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
      python3 scripts/backfill_lr_probabilities.py --out-dir sql/

Runs via .github/workflows/lr-backfill.yml, which uploads the SQL as an
artifact.
"""
import argparse
import json
import os
import sys
from collections import defaultdict

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from train_classic_classifier import CLUBS, STATS, fetch, load_vectors

# Below this many past covers a fold is fitting noise: the first months of the
# archive stay NULL rather than carrying a number nobody should trust.
MIN_TRAIN = 250
STATEMENTS_PER_FILE = 400


def month_of(date):
    return date[:7]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default=".", help="where to write the .sql files")
    ap.add_argument("--min-train", type=int, default=MIN_TRAIN)
    args = ap.parse_args()

    if not os.environ.get("CLOUDFLARE_ACCOUNT_ID") or not os.environ.get("CLOUDFLARE_API_TOKEN"):
        print("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Vectorize - Read).", file=sys.stderr)
        sys.exit(1)

    rows = json.loads(fetch(STATS))["rows"]
    rows = [r for r in rows if r["club"] in CLUBS]
    rows.sort(key=lambda r: r["date"])
    ids = [r["cover_id"] for r in rows]
    print(f"{len(rows)} labelled covers")

    stores = {k: load_vectors(ids, k) for k in ("image", "headline")}
    for k, s in stores.items():
        print(f"  {len(s)} found in the {k} index")

    kept = []
    for r in rows:
        img, head = stores["image"].get(r["cover_id"]), stores["headline"].get(r["cover_id"])
        if img is None or head is None:
            continue
        kept.append((r["cover_id"], r["date"], r["club"], np.concatenate([img, head])))
    print(f"{len(kept)} covers have both vectors ({len(rows) - len(kept)} stay NULL)\n")

    by_month = defaultdict(list)
    for item in kept:
        by_month[month_of(item[1])].append(item)

    updates, per_month = [], []
    for month in sorted(by_month):
        cutoff = f"{month}-01"
        train = [k for k in kept if k[1] < cutoff]
        if len(train) < args.min_train:
            print(f"{month}: only {len(train)} past covers, skipped (stays NULL)")
            continue

        X_train = np.stack([t[3] for t in train])
        y_train = np.array([t[2] for t in train])
        # Fitted on the training fold alone. A scaler fitted on everything
        # leaks the test month's distribution back into the model.
        scaler = StandardScaler().fit(X_train)
        clf = LogisticRegression(max_iter=1000).fit(scaler.transform(X_train), y_train)

        test = by_month[month]
        probs = clf.predict_proba(scaler.transform(np.stack([t[3] for t in test])))
        classes = list(clf.classes_)
        right = 0
        for (cover_id, _, club, _), p in zip(test, probs):
            col = {c: float(p[classes.index(c)]) if c in classes else 0.0 for c in CLUBS}
            right += (max(col, key=col.get) == club)
            updates.append(
                "UPDATE covers SET "
                f"ai_lr_benfica={col['benfica']:.6f}, ai_lr_porto={col['porto']:.6f}, "
                f"ai_lr_sporting={col['sporting']:.6f}, ai_lr_others={col['others']:.6f}, "
                f"ai_lr_asof='{cutoff}' WHERE id={cover_id};"
            )
        per_month.append((month, len(train), len(test), right / len(test)))
        print(f"{month}: train={len(train):>4}  test={len(test):>3}  accuracy {right / len(test):6.1%}")

    if not updates:
        print("nothing to write", file=sys.stderr)
        sys.exit(1)

    os.makedirs(args.out_dir, exist_ok=True)
    files = []
    for i in range(0, len(updates), STATEMENTS_PER_FILE):
        path = os.path.join(args.out_dir, f"lr_backfill_{i // STATEMENTS_PER_FILE:02d}.sql")
        with open(path, "w") as f:
            f.write("\n".join(updates[i:i + STATEMENTS_PER_FILE]) + "\n")
        files.append(path)

    total = sum(t for _, _, t, _ in per_month)
    weighted = sum(acc * t for _, _, t, acc in per_month) / total
    print(f"\nout-of-fold accuracy over {total} covers: {weighted:.1%}")
    print(f"months scored: {len(per_month)}  spread: "
          f"{min(a for *_, a in per_month):.1%} to {max(a for *_, a in per_month):.1%}")
    print(f"{len(updates)} UPDATE statements in {len(files)} file(s): {', '.join(files)}")


if __name__ == "__main__":
    main()
