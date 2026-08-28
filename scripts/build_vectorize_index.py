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
    ... scripts/build_vectorize_index.py --cover-id 1234   # one cover only
    ... ADMIN_SECRET=… scripts/build_vectorize_index.py --candidates   # backlog batch

Runs automatically via .github/workflows/vectorize-covers.yml (--candidates),
fired by the Worker's handleSwipe the moment a cover gets its first crowd
vote — see api/lib/github.js and api/handlers/swipes.js. --candidates pulls
the *whole* backlog from /vectorize-candidates (every voted cover with
vectorized_at IS NULL, self-converging like /rag-candidates — see
vectorize-candidates.js) rather than the one cover_id the dispatch actually
names: a burst of votes fires a burst of dispatches, and this way only the
first run to actually start finds work, the rest find an empty backlog and
exit in seconds instead of each paying the full CLIP/torch setup cost for
one vector. Each upserted batch gets marked done via /vectorize-mark before
moving on, so a later batch failing doesn't lose progress on earlier ones.
A missed dispatch still self-heals next time anything triggers this
workflow, nothing needs the exact cover_id that was actually in the
payload. --limit/--cover-id stay for manual runs (Vectorize upsert
overwrites by id, so any of these three modes re-running is idempotent).
HF_TOKEN is optional: unset, the weight download is anonymous (works fine,
just the lower unauthenticated rate limit).
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
API_BASE = os.environ.get("CAPAS_API", "https://capas.digasnikas.com/api")
# Cloudflare 403s the default urllib User-Agent — same fix as avg_cover.py.
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) capas-vectorize-build/1.0"
CLUBS = ("sporting", "benfica", "porto", "others")
MODEL_NAME = "openai/clip-vit-base-patch32"
INDEX = "capas-cover-embeddings"  # 512 dims, cosine — matches this model's projection_dim
BATCH = 500  # vectors per upsert call; HTTP API caps a batch at 5,000
DEFAULT_CANDIDATES_LIMIT = 500  # matches BATCH: usually clears the whole backlog in one upsert

ACCOUNT = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")
ADMIN_SECRET = os.environ.get("ADMIN_SECRET")  # only --candidates needs this (the Worker's own bearer token)
HF_TOKEN = os.environ.get("HF_TOKEN")  # optional: higher HF Hub rate limits, faster weight downloads


def fetch(url, tries=3, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception as e:
            if i == tries - 1:
                print(f"  skip {url}: {e}", file=sys.stderr)
                return None


def fetch_candidates(limit):
    """Every voted cover not yet embedded, from the Worker's own admin
    endpoint (not /api/stats: that one has no vectorized_at, and is public,
    while this needs ADMIN_SECRET). Normalized to the same field names as
    /api/stats rows (cover_id, not id) so the rest of the script doesn't
    need to know which source a row came from."""
    raw = fetch(f"{API_BASE}/vectorize-candidates?limit={limit}", headers={"Authorization": f"Bearer {ADMIN_SECRET}"})
    candidates = json.loads(raw) if raw else []
    return [{**c, "cover_id": c["id"]} for c in candidates]


def mark_vectorized(cover_ids):
    """Tells the Worker these ids are done (vectorized_at = now), so
    /vectorize-candidates stops returning them. Only ever called with ids
    from a batch that just upserted successfully — never in advance."""
    req = urllib.request.Request(
        f"{API_BASE}/vectorize-mark",
        data=json.dumps({"coverIds": cover_ids}).encode("utf-8"),
        headers={"Authorization": f"Bearer {ADMIN_SECRET}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        result = json.loads(r.read())
    if not result.get("success", True):
        raise RuntimeError(f"vectorize-mark failed: {result}")


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
    ap.add_argument("--cover-id", type=int, help="embed just this one cover_id (manual, single cover)")
    ap.add_argument(
        "--candidates", nargs="?", type=int, const=DEFAULT_CANDIDATES_LIMIT,
        help=f"embed the whole /vectorize-candidates backlog (default {DEFAULT_CANDIDATES_LIMIT}); "
             "this is what the GitHub Actions trigger uses, not --cover-id",
    )
    args = ap.parse_args()

    mark_as_done = None  # only set in --candidates mode

    if args.candidates:
        if not ADMIN_SECRET:
            print("Set ADMIN_SECRET (the Worker's own bearer token, not a Cloudflare token).", file=sys.stderr)
            sys.exit(1)
        rows = fetch_candidates(args.candidates)
        mark_as_done = mark_vectorized
    else:
        rows = json.loads(fetch(STATS))["rows"]
        rows = [r for r in rows if r["club"] in CLUBS]

        if args.cover_id:
            rows = [r for r in rows if r["cover_id"] == args.cover_id]
            if not rows:
                print(f"cover_id {args.cover_id} has no crowd vote yet — nothing to embed.", file=sys.stderr)
                sys.exit(1)
        else:
            rows.sort(key=lambda r: r["date"])
            if args.limit:
                rows = rows[-args.limit:]

    print(f"{len(rows)} labelled covers")
    if not rows:
        # The common case for --candidates: a burst of first-vote dispatches
        # all racing for the same backlog. Returning before the model even
        # loads is the whole point — every run after the first one that
        # actually finds work exits in seconds instead of paying for a
        # ~600MB CLIP download to embed nothing.
        print("nothing to do")
        return

    print(f"loading {MODEL_NAME} (first run downloads ~600MB)...")
    model = CLIPModel.from_pretrained(MODEL_NAME, token=HF_TOKEN)
    processor = CLIPProcessor.from_pretrained(MODEL_NAME, token=HF_TOKEN)
    model.eval()

    def flush(batch, batch_ids):
        upsert_batch(batch)
        # Marking done only after a successful upsert, and only for ids
        # that were actually in this batch, so a batch that fails to
        # upsert leaves its covers as candidates for the next run instead
        # of silently losing them.
        if mark_as_done:
            mark_as_done(batch_ids)

    batch, batch_ids, done, skipped = [], [], 0, 0
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
        batch_ids.append(r["cover_id"])

        if len(batch) >= BATCH:
            flush(batch, batch_ids)
            done += len(batch)
            print(f"  upserted {done}/{len(rows)}")
            batch, batch_ids = [], []
        elif (i + 1) % 50 == 0:
            print(f"  embedded {i + 1}/{len(rows)}")

    if batch:
        flush(batch, batch_ids)
        done += len(batch)

    print(f"done — {done} upserted, {skipped} skipped (download failures)")


if __name__ == "__main__":
    main()
