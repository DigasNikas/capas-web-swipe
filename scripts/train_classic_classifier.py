#!/usr/bin/env python3
"""Classic-ML exercise, not a production model: flatten each cover into a
pixel vector, fit several classic classifiers (plus one small from-scratch
neural net) on the crowd's own votes, and compare how each does against
covers it never trained on. No pretraining, no OCR, no transfer learning —
the shape an intro ML course teaches before reaching for anything smarter.

Not meant to compete with the zero-shot AI Detector (documentation#ai-detector)
or its 77% archive-wide agreement; the point here is the exercise itself.

    python3 -m venv .venv && .venv/bin/pip install numpy pillow scikit-learn
    .venv/bin/pip install torch          # optional — adds the MLP model
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
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.naive_bayes import GaussianNB
from sklearn.neighbors import KNeighborsClassifier
from sklearn.svm import LinearSVC
from sklearn.tree import DecisionTreeClassifier

STATS = "https://capas.digasnikas.com/api/stats"
# Cloudflare 403s the default urllib User-Agent — same fix as avg_cover.py.
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) capas-classic-classifier/1.0"
SIZE = 32  # each cover shrinks to SIZE x SIZE before flattening
CLUBS = ("sporting", "benfica", "porto", "others")

# One classifier per family — linear, distance-based, two tree-based, margin,
# probabilistic — all fit on the exact same flattened pixel vectors, so the
# comparison is about the algorithm, not the input.
MODELS = {
    "Logistic Regression": LogisticRegression(max_iter=1000),
    "k-Nearest Neighbors":  KNeighborsClassifier(n_neighbors=5),
    "Decision Tree":        DecisionTreeClassifier(max_depth=10, random_state=0),
    "Random Forest":        RandomForestClassifier(n_estimators=100, random_state=0),
    "Linear SVM":           LinearSVC(max_iter=5000),
    "Naive Bayes":          GaussianNB(),
}


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


def train_mlp(X_train, y_train, X_test, epochs=60):
    """The one model here that's actually tensor-based: a small two-layer
    feedforward net trained from scratch via backprop (Adam + cross-entropy)
    on the same input vectors every sklearn model above gets — no
    pretraining, so it's still the from-scratch exercise, just with an
    actual tensor library instead of numpy doing the fitting. Optional:
    skipped with a note if torch isn't installed, since it's a heavier
    dependency than the rest of this script needs."""
    import torch
    import torch.nn as nn

    club_to_idx = {c: i for i, c in enumerate(CLUBS)}
    Xt = torch.tensor(X_train, dtype=torch.float32)
    yt = torch.tensor([club_to_idx[c] for c in y_train], dtype=torch.long)

    model = nn.Sequential(
        nn.Linear(X_train.shape[1], 128),
        nn.ReLU(),
        nn.Linear(128, len(CLUBS)),
    )
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    loss_fn = nn.CrossEntropyLoss()

    model.train()
    for _ in range(epochs):
        opt.zero_grad()
        loss_fn(model(Xt), yt).backward()
        opt.step()

    model.eval()
    with torch.no_grad():
        pred_idx = model(torch.tensor(X_test, dtype=torch.float32)).argmax(dim=1).numpy()
    idx_to_club = {i: c for c, i in club_to_idx.items()}
    return np.array([idx_to_club[i] for i in pred_idx])


def evaluate(name, y_test, pred):
    acc = accuracy_score(y_test, pred)
    print(f"\n=== {name} ===")
    print(f"accuracy  {acc:.1%}")
    print(classification_report(y_test, pred, labels=CLUBS, zero_division=0))
    print("confusion matrix (rows: true, cols: predicted)")
    cm = confusion_matrix(y_test, pred, labels=CLUBS)
    print(f"{'':10}" + "".join(f"{c[:6]:>8}" for c in CLUBS))
    for label, row in zip(CLUBS, cm):
        print(f"{label:10}" + "".join(f"{n:8d}" for n in row))
    return acc


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

    results = []
    for name, clf in MODELS.items():
        clf.fit(X_train, y_train)
        acc = evaluate(name, y_test, clf.predict(X_test))
        results.append((name, acc))

    try:
        pred = train_mlp(X_train, y_train, X_test)
        acc = evaluate("Small MLP (PyTorch, from scratch)", y_test, pred)
        results.append(("Small MLP (PyTorch, from scratch)", acc))
    except ImportError:
        print("\n(skipping the PyTorch MLP — `pip install torch` to include it)")

    print("\n=== summary (by accuracy) ===")
    for name, acc in sorted(results, key=lambda r: -r[1]):
        print(f"  {name:<34} {acc:.1%}")


if __name__ == "__main__":
    main()
