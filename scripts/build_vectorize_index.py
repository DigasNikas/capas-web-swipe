#!/usr/bin/env python3
"""Build a Vectorize index of cover images so "covers that looked like this
one" becomes a query instead of something a human has to eyeball.

One vector per crowd-labelled cover (same filter as avg_cover.py and
train_classic_classifier.py: only covers with a vote in analytics_covers —
an unvoted cover has no trustworthy label to attach). Embedded with CLIP
(openai/clip-vit-base-patch32), run locally via transformers rather than a
hosted API: HuggingFace's shared serverless Inference API has no clean
REST route for raw image embeddings (confirmed by HF staff on their own
forums — CLIP's default pipeline there is zero-shot-image-classification,
not feature-extraction), so the reliable option is the same one
avg_cover.py and train_classic_classifier.py already use for their own
image work — run it locally, no external API, no token, no rate limit.
The model is a public download (~600MB), no HF account needed.

Metadata carries the crowd's vote (club) plus enough to identify the cover
without a second round trip (newspaper, date, url). Deliberately NOT
ai_club: as of 2026-08-26 only 56 of 1,765 covers reflect the *current*
prompt — the rest are stale (an older prompt's leftover) or missing
entirely, so it isn't a signal worth freezing into the index yet. Revisit
once the backfill has actually caught the archive up.

    python3 -m venv .venv && .venv/bin/pip install numpy pillow torch transformers
    CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… .venv/bin/python scripts/build_vectorize_index.py
    ... scripts/build_vectorize_index.py --limit 50   # quick run
"""
import argparse
import io
import json
import os
import sys
import urllib.error
import urllib.request

import numpy as np
import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

STATS = "https://capas.digasnikas.com/api/stats"
# Cloudflare 403s the default urllib User-Agent — same fix as avg_cover.py.
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) capas-vectorize-build/1.0"
CLUBS = ("sporting", "benfica", "porto", "others")
MODEL_NAME = "openai/clip-vit-base-patch32"
INDEX = "capas-cover-embeddings"  # 512 dims, cosine — matches this model's projection_dim
BATCH = 500  # vectors per upsert call; HTTP API caps a batch at 5,000

ACCOUNT = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")


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


def load_image(url):
    raw = fetch(url)
    if raw is None:
        return None
    return Image.open(io.BytesIO(raw)).convert("RGB")


def embed(model, processor, image):
    """CLIP's image projection, L2-normalized. get_image_features() returns
    a full output object in this transformers version, not a bare tensor —
    .pooler_output is where the projected (1, 512) embedding actually is;
    indexing the object itself lands on last_hidden_state (1, 50, 768), the
    pre-projection per-patch encoder output, which is not what we want
    here."""
    inputs = processor(images=image, return_tensors="pt")
    with torch.no_grad():
        out = model.get_image_features(**inputs)
    vec = out.pooler_output[0].numpy()
    return (vec / np.linalg.norm(vec)).tolist()


def upsert_batch(vectors):
    ndjson = "\n".join(json.dumps(v) for v in vectors).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/vectorize/v2/indexes/{INDEX}/upsert",
        data=ndjson,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/x-ndjson"},
        method="POST",
    )
    # A bad account id or token surfaces as an HTTPError, whose body is
    # Cloudflare's actual JSON error — worth reading and printing plainly
    # instead of letting a bare traceback swallow it.
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            result = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"upsert HTTP {e.code}: {e.read().decode('utf-8', 'replace')}") from None
    if not result.get("success"):
        raise RuntimeError(f"upsert failed: {result.get('errors')}")
    return result


def main():
    if not ACCOUNT or not TOKEN:
        print("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Vectorize · Write).", file=sys.stderr)
        sys.exit(1)

    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, help="embed only the N most recent labelled covers (faster iteration)")
    args = ap.parse_args()

    rows = json.loads(fetch(STATS))["rows"]
    rows = [r for r in rows if r["club"] in CLUBS]
    rows.sort(key=lambda r: r["date"])
    if args.limit:
        rows = rows[-args.limit:]
    print(f"{len(rows)} labelled covers")

    print(f"loading {MODEL_NAME} (first run downloads ~600MB)...")
    model = CLIPModel.from_pretrained(MODEL_NAME)
    processor = CLIPProcessor.from_pretrained(MODEL_NAME)
    model.eval()

    batch, done, skipped = [], 0, 0
    for i, r in enumerate(rows):
        img = load_image(r["url"])
        if img is None:
            skipped += 1
            continue

        batch.append({
            "id": str(r["cover_id"]),
            "values": embed(model, processor, img),
            "metadata": {
                "club": r["club"],
                "newspaper": r["newspaper"],
                "date": r["date"],
                "url": r["url"],
            },
        })

        if len(batch) >= BATCH:
            upsert_batch(batch)
            done += len(batch)
            print(f"  upserted {done}/{len(rows)}")
            batch = []
        elif (i + 1) % 50 == 0:
            print(f"  embedded {i + 1}/{len(rows)}")

    if batch:
        upsert_batch(batch)
        done += len(batch)

    print(f"done — {done} upserted, {skipped} skipped (download failures)")


if __name__ == "__main__":
    main()
