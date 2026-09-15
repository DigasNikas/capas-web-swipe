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
    .venv/bin/python scripts/train_classic_classifier.py --per-newspaper
    .venv/bin/python scripts/train_classic_classifier.py --residual
"""
import argparse
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.model_selection import train_test_split
from sklearn.naive_bayes import GaussianNB
from sklearn.preprocessing import StandardScaler
from sklearn.neighbors import KNeighborsClassifier
from sklearn.svm import LinearSVC
from sklearn.tree import DecisionTreeClassifier

STATS = "https://capas.digasnikas.com/api/stats"
ACCOUNT = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")
# The same two indexes the AI Detector retrieves from. --features reads the
# vectors straight back out of them, so a cover's features here are exactly
# what production compares it against — and 512 CLIP dimensions off the
# full-res original beat a 32x32 thumbnail, which is the resolution at which
# the vision model itself fell from 67% to 53% (see api/lib/ai.js).
INDEXES = {"image": ("capas-cover-embeddings", 512), "headline": ("capas-headline-embeddings", 768)}
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


def load_vectors(ids, index):
    """cover id -> its stored vector, pulled back out of Vectorize.

    No re-embedding: get_by_ids returns the values that production retrieval
    already uses. Covers missing from the index (no scraped text, for the
    headline one) simply do not come back, and the caller drops them.
    """
    name, dims = INDEXES[index]
    out = {}
    # 20 is the API's cap: more comes back as 40007 "too many ids in payload".
    for i in range(0, len(ids), 20):
        batch = [str(x) for x in ids[i:i + 20]]
        req = urllib.request.Request(
            f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/vectorize/v2/indexes/{name}/get_by_ids",
            data=json.dumps({"ids": batch, "returnValues": True}).encode("utf-8"),
            headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", "User-Agent": UA},
            method="POST",
        )
        # 90-odd batches per index, and the odd one comes back 504 "upstream
        # service unavailable" — retry rather than lose the whole run.
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    found = json.loads(r.read())["result"]
                break
            except (urllib.error.HTTPError, urllib.error.URLError) as e:
                code = getattr(e, "code", None)
                if attempt == 3 or (code and code < 500 and code != 429):
                    body = e.read().decode("utf-8", "replace")[:200] if hasattr(e, "read") else str(e)
                    print(f"Vectorize refused a batch: {code} {body}", file=sys.stderr)
                    sys.exit(1)
                time.sleep(2 ** attempt)
        for v in (found if isinstance(found, list) else found.get("vectors", [])):
            if v.get("values") and len(v["values"]) == dims:
                out[int(v["id"])] = np.asarray(v["values"], dtype=np.float32)
    return out


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

    club_to_idx = {c: i for i, c in enumerate(sorted(set(y_train)))}
    Xt = torch.tensor(X_train, dtype=torch.float32)
    yt = torch.tensor([club_to_idx[c] for c in y_train], dtype=torch.long)

    model = nn.Sequential(
        nn.Linear(X_train.shape[1], 128),
        nn.ReLU(),
        nn.Linear(128, len(club_to_idx)),
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
    # Labels come from the data, not from CLUBS: --binary relabels everything
    # to "others" vs "a club", and a report fixed to the four clubs prints
    # four empty rows and hides the only number that matters.
    labels = sorted(set(y_test) | set(pred))
    acc = accuracy_score(y_test, pred)
    print(f"\n=== {name} ===")
    print(f"accuracy  {acc:.1%}")
    print(classification_report(y_test, pred, labels=labels, zero_division=0))
    print("confusion matrix (rows: true, cols: predicted)")
    cm = confusion_matrix(y_test, pred, labels=labels)
    print(f"{'':10}" + "".join(f"{c[:6]:>8}" for c in labels))
    for label, row in zip(labels, cm):
        print(f"{label:10}" + "".join(f"{n:8d}" for n in row))
    return acc


def split_data(X, y, papers, mode):
    """Splits X, y and each row's newspaper together, three parallel arrays
    cut the same way — papers is needed downstream by --residual, which has
    to know which newspaper's own training-set mean to subtract from which
    row."""
    if mode == "stratified":
        # Random, but each class keeps its overall proportion in both halves
        # — the textbook default. Still a random split under the hood, so
        # it carries the same leakage risk chronological avoids: covers
        # share a masthead template within a stretch of dates, and this can
        # put near-duplicate examples on both sides of the split.
        return train_test_split(X, y, papers, test_size=0.2, stratify=y, random_state=0)
    # Chronological — train on the older 80%, test on the most recent 20%.
    # Immune to that leakage, and the honest version of the real question,
    # "can this predict a cover it's never seen," since training only ever
    # sees the past — at the cost of the test set's class balance being
    # whatever the most recent stretch happens to be.
    split = int(len(X) * 0.8)
    return X[:split], X[split:], y[:split], y[split:], papers[:split], papers[split:]


def apply_residual(X_train, papers_train, X_test, papers_test):
    """Subtract each newspaper's own mean cover — computed from the training
    rows only, the test rows never contribute — from every vector of that
    newspaper. Same idea as the dashboard's "a capa média" (masthead stays
    sharp, headlines dissolve into a ghost), computed fresh in this SIZE x
    SIZE pixel space rather than reused from dashboard/avg/*.jpg: those are
    built in a different, aligned 620px coordinate frame (avg_cover.py
    shifts each cover to line up masthead position across two scrape eras),
    and subtracting an aligned average from an unaligned cover here would
    misregister by however far that cover's own shift was — worse than no
    subtraction at all for the covers that need the biggest shift. Recomputing
    per split keeps everything in one consistent, if cruder, coordinate frame.
    """
    Xtr, Xte = X_train.copy(), X_test.copy()
    for paper in np.unique(papers_train):
        mean = X_train[papers_train == paper].mean(axis=0)
        Xtr[papers_train == paper] -= mean
        Xte[papers_test == paper] -= mean
    return Xtr, Xte


def run_experiment(title, X, y, papers, split_mode, residual, scale=False):
    """Split, fit every model, evaluate. Shared by the pooled run and each
    per-newspaper run — same models, same split logic, different rows."""
    X_train, X_test, y_train, y_test, papers_train, papers_test = split_data(X, y, papers, split_mode)
    if residual:
        X_train, X_test = apply_residual(X_train, papers_train, X_test, papers_test)
    if scale:
        # Embedding dimensions sit around 0.03; every model here uses its
        # sklearn default C, so that scale decides how much the L2 penalty
        # bites. Standardising says whether a model lost on the maths or on
        # the features.
        sc = StandardScaler().fit(X_train)
        X_train, X_test = sc.transform(X_train), sc.transform(X_test)
    tag = f"split={split_mode}" + (" residual" if residual else "") + (" scaled" if scale else "")
    print(f"\n### {title} — {tag}  train={len(X_train)}  test={len(X_test)}")

    results = []
    for name, clf in MODELS.items():
        clf = clf.__class__(**clf.get_params())  # fresh instance — don't reuse fitted state across newspapers
        clf.fit(X_train, y_train)
        acc = evaluate(name, y_test, clf.predict(X_test))
        results.append((name, acc))

    try:
        pred = train_mlp(X_train, y_train, X_test)
        acc = evaluate("Small MLP (PyTorch, from scratch)", y_test, pred)
        results.append(("Small MLP (PyTorch, from scratch)", acc))
    except ImportError:
        print("\n(skipping the PyTorch MLP — `pip install torch` to include it)")

    print(f"\n=== {title} summary (by accuracy) ===")
    for name, acc in sorted(results, key=lambda r: -r[1]):
        print(f"  {name:<34} {acc:.1%}")
    return dict(results)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, help="use only the N most recent labelled covers (faster iteration)")
    ap.add_argument("--features", choices=["pixels", "image", "headline", "both"], default="pixels",
                     help="pixels (default): a 32x32 thumbnail flattened, the classic-ML exercise. image: the "
                          "cover's CLIP vector from capas-cover-embeddings. headline: its lead-headline vector "
                          "from capas-headline-embeddings. both: the two concatenated — a split page is a "
                          "layout fact and a text fact at once. The vector modes need Cloudflare credentials "
                          "and skip covers missing from the index")
    ap.add_argument("--binary", action="store_true",
                     help="collapse the four clubs to others vs a club — the class the AI Detector misses, "
                          "which a four-class accuracy number hides. Base rate is ~21%% others, so anything "
                          "under ~79%% accuracy loses to always answering 'a club'")
    ap.add_argument("--split", choices=["chronological", "stratified"], default="chronological",
                     help="chronological (default): train on the older 80%%, test on the most recent 20%% — "
                          "honest about the real question ('can this predict a cover it hasn't seen') and "
                          "immune to masthead-template leakage. stratified: sklearn's random stratified "
                          "train_test_split, preserving each class's proportion in both halves — the more "
                          "textbook default, at the cost of reintroducing that same leakage risk")
    ap.add_argument("--per-newspaper", action="store_true",
                     help="train and test a separate set of models per newspaper, instead of pooling all "
                          "newspapers together. Controls for each paper's own masthead/layout: pooled "
                          "training can let a model shortcut on 'which paper is this' (which correlates "
                          "with club) rather than actually reading the cover")
    ap.add_argument("--scale", action="store_true",
                    help="standardise features before fitting")
    ap.add_argument("--residual", action="store_true",
                     help="subtract each newspaper's own average cover (mean of the training rows only) "
                          "from every vector before fitting — isolates whatever varies day to day from the "
                          "fixed masthead/layout, the same idea as the dashboard's 'a capa média' feature")
    args = ap.parse_args()

    rows = json.loads(fetch(STATS))["rows"]
    rows = [r for r in rows if r["club"] in CLUBS]
    rows.sort(key=lambda r: r["date"])  # chronological order, for the split below
    if args.limit:
        rows = rows[-args.limit:]
    print(f"{len(rows)} labelled covers")

    if args.features == "pixels":
        with ThreadPoolExecutor(12) as pool:
            vectors = list(pool.map(lambda r: vectorize(r["url"]), rows))
        kept = [(v, r["club"], r["newspaper"]) for v, r in zip(vectors, rows) if v is not None]
        print(f"{len(kept)} vectorized ({len(rows) - len(kept)} failed to download)")
    else:
        if not ACCOUNT or not TOKEN:
            print("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Vectorize · Read).", file=sys.stderr)
            sys.exit(1)
        ids = [r["cover_id"] for r in rows]
        wanted = ["image", "headline"] if args.features == "both" else [args.features]
        stores = {k: load_vectors(ids, k) for k in wanted}
        for k in wanted:
            print(f"{len(stores[k])} of {len(ids)} covers found in the {k} index")
        kept = []
        for r in rows:
            parts = [stores[k].get(r["cover_id"]) for k in wanted]
            if any(p is None for p in parts):
                continue
            kept.append((np.concatenate(parts), r["club"], r["newspaper"]))
        print(f"{len(kept)} covers usable with features={args.features}")

    if args.binary:
        kept = [(v, "others" if c == "others" else "a club", p) for v, c, p in kept]
        share = sum(1 for _, c, _ in kept if c == "others") / len(kept)
        print(f"binary mode: {share:.1%} others — always answering 'a club' scores {1 - share:.1%}")

    if not args.per_newspaper:
        X = np.stack([v for v, _, _ in kept])
        y = np.array([c for _, c, _ in kept])
        papers = np.array([p for _, _, p in kept])
        run_experiment("Pooled (all newspapers)", X, y, papers, args.split, args.residual, args.scale)
        return

    newspapers = sorted({p for _, _, p in kept})
    per_paper_results = {}
    for paper in newspapers:
        subset = [(v, c) for v, c, p in kept if p == paper]
        X = np.stack([v for v, _ in subset])
        y = np.array([c for _, c in subset])
        papers = np.full(len(X), paper)
        per_paper_results[paper] = run_experiment(paper, X, y, papers, args.split, args.residual, args.scale)

    model_names = list(per_paper_results[newspapers[0]].keys())
    print("\n=== accuracy by model x newspaper ===")
    print(f"{'':34}" + "".join(f"{p:>10}" for p in newspapers))
    for name in model_names:
        print(f"{name:34}" + "".join(f"{per_paper_results[p][name]:9.1%} " for p in newspapers))


if __name__ == "__main__":
    main()
