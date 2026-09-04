#!/usr/bin/env python3
"""Build a Vectorize index of lead headlines so "covers about this story"
becomes a query, alongside the existing "covers that look like this one".

The image index (build_vectorize_index.py, capas-cover-embeddings) retrieves
by page layout as much as by subject — image-embeddings.md documents that
bias, and rag.md's few-shot block has to disclaim itself because of it. This
index retrieves by what the front page actually says, which is the signal
the classifier is mostly reading anyway (see the benchmark at the top of
api/lib/ai.js: full-resolution beats thumbnails because these covers are
called by their Portuguese text).

One vector per crowd-labelled cover that has scraped headlines, embedded
from the lead story only (see headline_embeddings.lead_headline for which
part that is and why). Same filter as the image index: no crowd vote, no
vector, because an unvoted cover has no trustworthy label to attach.
Metadata carries the crowd's club plus newspaper and date — date is what
lets the query side drop same-day siblings, which otherwise dominate every
result (the three papers print the same story the same day in near-identical
words).

    python3 -m venv .venv && .venv/bin/pip install numpy torch transformers
    CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… ADMIN_SECRET=… \
      .venv/bin/python scripts/build_headline_index.py
    ... scripts/build_headline_index.py --limit 50    # smaller batch

Runs via .github/workflows/vectorize-headlines.yml, on the same
cover-first-vote dispatch the image index uses, plus its own manual
trigger. Self-converging exactly like the image index: /vectorize-candidates
?index=headline returns whatever still has headline_vectorized_at IS NULL,
and /vectorize-mark {index: "headline"} clears each batch only after it
upserts, so a failed batch stays in the backlog instead of being marked done
and silently dropped.

A cover that has a vote but no headlines is not a candidate at all, and that
is not a backlog to clear: past-date scrapes never set the column (see
headlines.md), so roughly a fifth of the archive will never enter this index.
Those covers still get image retrieval, and classify fine without either.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

from headline_embeddings import TEXT_DIMS, embed_text, lead_headline, load_text_model

API_BASE = os.environ.get("CAPAS_API", "https://capas.digasnikas.com/api")
# Cloudflare 403s the default urllib User-Agent — same fix as the other scripts.
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) capas-headline-build/1.0"
INDEX = "capas-headline-embeddings"
BATCH = 500  # vectors per upsert call; the HTTP API caps a batch at 5,000
DEFAULT_LIMIT = 500  # matches BATCH: usually clears the whole backlog in one upsert

ACCOUNT = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")
ADMIN_SECRET = os.environ.get("ADMIN_SECRET")
HF_TOKEN = os.environ.get("HF_TOKEN")


def fetch(url, headers=None, data=None, method=None):
    req = urllib.request.Request(url, data=data, method=method, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def candidates(limit):
    raw = fetch(
        f"{API_BASE}/vectorize-candidates?index=headline&limit={limit}",
        headers={"Authorization": f"Bearer {ADMIN_SECRET}"},
    )
    return json.loads(raw) if raw else []


def mark_done(cover_ids):
    """Only ever called with ids from a batch that just upserted."""
    raw = fetch(
        f"{API_BASE}/vectorize-mark",
        data=json.dumps({"cover_ids": cover_ids, "index": "headline"}).encode("utf-8"),
        headers={"Authorization": f"Bearer {ADMIN_SECRET}", "Content-Type": "application/json"},
        method="POST",
    )
    result = json.loads(raw)
    if not result.get("ok"):
        raise RuntimeError(f"vectorize-mark failed: {result}")


def upsert_batch(vectors):
    ndjson = "\n".join(json.dumps(v) for v in vectors).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/vectorize/v2/indexes/{INDEX}/upsert",
        data=ndjson,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/x-ndjson"},
        method="POST",
    )
    # A bad account id or token surfaces as an HTTPError whose body is
    # Cloudflare's own JSON error — worth printing plainly rather than
    # letting a bare traceback swallow it.
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            result = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"upsert HTTP {e.code}: {e.read().decode('utf-8', 'replace')}") from None
    if not result.get("success"):
        raise RuntimeError(f"upsert failed: {result.get('errors')}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="max covers to embed this run")
    args = ap.parse_args()

    if not (ACCOUNT and TOKEN and ADMIN_SECRET):
        print("Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and ADMIN_SECRET.", file=sys.stderr)
        sys.exit(1)

    rows = candidates(args.limit)
    print(f"{len(rows)} candidates")
    if not rows:
        return

    model, tokenizer = load_text_model(HF_TOKEN)
    print(f"model loaded ({TEXT_DIMS} dims)")

    batch, batch_ids, done, skipped = [], [], 0, 0
    for i, row in enumerate(rows):
        lead = lead_headline(row.get("headlines"))
        if not lead:
            # The endpoint filters on headlines IS NOT NULL, so this is the
            # rare row whose text is markup or whitespace only.
            skipped += 1
            continue

        batch.append({
            "id": str(row["id"]),
            "values": embed_text(model, tokenizer, lead),
            "metadata": {"club": row["club"], "newspaper": row["newspaper"], "date": row["date"]},
        })
        batch_ids.append(row["id"])

        if len(batch) >= BATCH:
            upsert_batch(batch)
            mark_done(batch_ids)
            done += len(batch)
            print(f"  upserted {done}/{len(rows)}")
            batch, batch_ids = [], []
        elif (i + 1) % 100 == 0:
            print(f"  embedded {i + 1}/{len(rows)}")

    if batch:
        upsert_batch(batch)
        mark_done(batch_ids)
        done += len(batch)

    print(f"done — {done} upserted, {skipped} skipped (no usable lead headline)")


if __name__ == "__main__":
    main()
