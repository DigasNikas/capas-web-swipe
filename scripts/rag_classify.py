#!/usr/bin/env python3
"""RAG-augmented cover reclassification: embed a cover twice — the image
with CLIP, the lead headline with multilingual-e5-base — retrieve similar
labelled covers from both Vectorize indexes, merge them, fold their labels
into the Llama4 prompt as few-shot context, classify, and (in live mode)
write the result to D1 through the Worker's admin API.

The two channels answer different questions: capas-cover-embeddings finds
covers that look like this page, capas-headline-embeddings finds covers
about this story. See dashboard/documentation/headline-embeddings.md for
why the second one exists and what it is measured to be worth.

Runs outside the Worker because Workers AI has no CLIP model and no live
embedding service exists for this project — see dashboard/documentation/rag.md
for why a Docker/Gradio HF Space (the original plan) isn't an option:
creating one now requires a paid HF Pro subscription this account doesn't
have. This script is what keeps the AI Detector section's RAG classification
fresh day to day instead, via a scheduled GitHub Actions run
(.github/workflows/rag-classify.yml) rather than a live per-request call in
the Worker.

Two modes:

  Live (default) — pulls the most recent covers from /rag-candidates,
  reclassifies each, writes to D1 via /reclassify-rag:

    CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… ADMIN_SECRET=… \
      .venv/bin/python scripts/rag_classify.py
    ... scripts/rag_classify.py --limit 5      # smaller batch

  --eval — scores the RAG-augmented prompt against the crowd labels, same
  report shape as scripts/eval-ai.mjs but with real embeddings (that script
  can't do this itself — Node has no CLIP model):

    CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… \
      .venv/bin/python scripts/rag_classify.py --eval --n 80

The Cloudflare token needs Workers AI · Read and Vectorize · Read. Live mode
additionally needs ADMIN_SECRET (the Worker's own bearer token, not a
Cloudflare token) for /rag-candidates and /reclassify-rag. HF_TOKEN is
optional: unset, the CLIP weight download is unauthenticated (works fine,
just the lower rate limit + slower download HuggingFace applies to anonymous
requests); set, it's passed straight to from_pretrained().

PROMPT, MODEL, CLUBS, RAG_TOP_K, HEADLINES_MAX_CHARS and the few-shot and
headlines blocks' exact wording are copied from api/lib/ai.js rather than
shared — Python can't import a JS module. (lead_headline and the text model
live in headline_embeddings.py, imported by both this script and
build_headline_index.py, because a query vector built differently from the
indexed ones silently skews every similarity against them.) Keep both copies identical by hand; a mismatch here means this
script silently measures or produces something different from what the
Worker's own classifyCover would given the same inputs.
"""
import argparse
import base64
import io
import json
import os
import re
import sys
import urllib.request
from itertools import zip_longest

import numpy as np
import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

from headline_embeddings import embed_text, lead_headline, load_text_model

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) capas-rag-classify/1.0"
CLIP_MODEL_NAME = "openai/clip-vit-base-patch32"
IMAGE_INDEX = "capas-cover-embeddings"
HEADLINE_INDEX = "capas-headline-embeddings"
MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct"
CLUBS = ("benfica", "sporting", "porto", "others")
RAG_TOP_K = 7
HEADLINES_MAX_CHARS = 600
STATS = os.environ.get("CAPAS_STATS", "https://capas.digasnikas.com/api/stats")
API_BASE = os.environ.get("CAPAS_API", "https://capas.digasnikas.com/api")
HF_TOKEN = os.environ.get("HF_TOKEN")  # optional: higher HF Hub rate limits, faster weight downloads

# Copied verbatim from api/lib/ai.js's PROMPT — keep in sync by hand.
PROMPT = (
    "You are looking at the front page of a Portuguese sports daily (Record, A Bola or O Jogo).\n"
    "Find the largest photo on the page — the one that takes up most of the visible space. "
    "Name the football club that photo is about, then read ONLY that photo's own headline, "
    "the text printed next to or under it.\n"
    "\n"
    "A page is dominated by whichever club's photo and headline together occupy the most space, "
    "pushing everything else into smaller boxes, strips and corners. A headline can read as dramatic "
    "or sit near the top of the page and still not be the dominant story — if it sits over a small "
    "photo or no photo at all, the large photo elsewhere on the page is what the cover is about.\n"
    "\n"
    "Ignore these. They are on every edition and say nothing about the day:\n"
    "- the newspaper's own masthead and its colour (Record and A Bola are red; that is branding, not Benfica)\n"
    "- the small section boxes and side rails headed SPORTING, FC PORTO or BENFICA\n"
    "- teasers, adverts, cartoons and results bars along the edges\n"
    "- small headline strips over a small photo or no photo, even near the top of the page\n"
    "\n"
    "How the clubs are named on these pages:\n"
    "- benfica: Benfica, SLB, Aguias, Encarnados, da Luz\n"
    "- sporting: Sporting, SCP, Leoes, Alvalade, verde-e-brancos\n"
    "- porto: FC Porto, FCP, Dragoes, Dragao, azuis-e-brancos\n"
    "- others: the main story is none of those three — the Portugal national team, "
    "Braga, Guimaraes or another club, another sport (cycling, futsal), "
    "or a transfer round-up with no single club on top\n"
    "\n"
    "Reply in exactly three lines:\n"
    "HEADLINE: <the headline belonging to the largest photo, copied>\n"
    "WHY: <the one detail that decided it — a name, nickname or kit colour word from that photo or its headline>\n"
    "ANSWER: <benfica|sporting|porto|others>"
)

ACCOUNT = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")
ADMIN_SECRET = os.environ.get("ADMIN_SECRET")


def fetch(url, headers=None, data=None, method=None, tries=3):
    # Every call to capas.digasnikas.com has to go through this, GET or
    # POST: it sits behind Cloudflare Bot Fight Mode, which challenges
    # requests carrying Python's default urllib user-agent (a 403, not a
    # 401 — nothing to do with ADMIN_SECRET). Same issue already documented
    # in eval-ai.mjs and scrape.yml for their own runners.
    req = urllib.request.Request(url, data=data, method=method, headers={"User-Agent": UA, **(headers or {})})
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception:
            if i == tries - 1:
                raise


def embed(model, processor, image):
    """CLIP's image projection, L2-normalized — same as
    scripts/build_vectorize_index.py's embed(), which built the live index;
    any drift here silently skews cosine similarity against it. The
    hasattr check covers both transformers API shapes seen this project:
    older/differently-pinned versions return a bare (1, 512) tensor from
    get_image_features(), newer ones wrap it in an object with
    .pooler_output — confirmed numerically identical output either way."""
    inputs = processor(images=image, return_tensors="pt")
    with torch.no_grad():
        out = model.get_image_features(**inputs)
    vec = out.pooler_output[0].numpy() if hasattr(out, "pooler_output") else out[0].numpy()
    return (vec / np.linalg.norm(vec)).tolist()


def query_vectorize(index, vector, top_k):
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/vectorize/v2/indexes/{index}/query",
        data=json.dumps({"vector": vector, "topK": top_k, "returnMetadata": "all"}).encode("utf-8"),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        result = json.loads(r.read())
    if not result.get("success"):
        raise RuntimeError(f"Vectorize query failed on {index}: {result.get('errors')}")
    return result["result"]["matches"]


def usable_matches(matches, via, cover_date):
    """Drops what must never reach the prompt, in both channels.

    The same-date rule is the one that matters for the headline index:
    Record, A Bola and O Jogo print the same story the same day in
    near-identical words, so an unfiltered text query returns today's
    siblings and the prior collapses into copying the neighbouring paper's
    crowd vote. Filtered here rather than as a Vectorize metadata filter
    because that would need a metadata index created up front, and
    over-fetching a few and dropping them locally costs nothing at this size.

    The score rule is the existing self-match guard: a cover already in an
    index matches itself at ~0.99999.
    """
    kept = []
    for m in matches or []:
        if m.get("score", 0) >= 0.999:
            continue
        meta = m.get("metadata") or {}
        if not meta.get("club"):
            continue
        if cover_date and meta.get("date") == cover_date:
            continue
        kept.append({**m, "via": via})
    return kept


def merge_channels(headline_matches, image_matches, top_k=RAG_TOP_K):
    """Alternates between the two channels, headline first, until top_k.

    Headline first because it is the better prior: measured over the archive,
    a nearest text neighbour agrees with the crowd about two thirds of the
    time (see headline_embeddings.py), while image similarity is documented
    to track newspaper layout as much as subject. Alternating rather than
    filling from one channel keeps a cover with a thin headline index from
    losing its image context entirely.

    A cover found by both channels appears once, credited to the headline
    channel, since that is the stronger reason for it being there.
    """
    merged, seen = [], set()
    for pair in zip_longest(headline_matches, image_matches):
        for m in pair:
            if m is None or m["id"] in seen or len(merged) >= top_k:
                continue
            seen.add(m["id"])
            merged.append(m)
    return merged


def build_few_shot_block(matches):
    """Mirrors api/lib/ai.js's buildFewShotBlock exactly — same filter, same
    tally, same tie-break, same wording. Keep both in sync by hand."""
    usable = [
        m for m in (matches or [])
        if m.get("score", 0) < 0.999 and (m.get("metadata") or {}).get("club")
    ]
    if not usable:
        return ""

    counts = {}
    for m in usable:
        club = m["metadata"]["club"]
        counts[club] = counts.get(club, 0) + 1
    tally = ", ".join(
        f"{n} {club}" for club, n in
        sorted(counts.items(), key=lambda kv: (-kv[1], CLUBS.index(kv[0])))
    )

    # Anything that predates the second index has no "via" and is a layout
    # match, which is what the image index has always been.
    by_headline = sum(1 for m in usable if m.get("via") == "headline")
    by_layout = len(usable) - by_headline
    both = "both" if len(usable) == 2 else str(len(usable))
    if by_headline and by_layout:
        channels = f"{by_headline} matched by headline wording, {by_layout} by page layout"
    elif by_headline:
        channels = f"{both} matched by headline wording"
    else:
        channels = f"{both} matched by page layout"

    return (
        f"Reference: {len(usable)} past front pages from this archive were crowd-labelled: "
        f"{tally} ({channels}). A headline match is about the same story; a layout match tracks "
        "newspaper design as much as subject. Treat this only as a weak prior, not a verdict.\n\n"
    )


def build_headlines_block(headlines):
    """Mirrors api/lib/ai.js's buildHeadlinesBlock exactly — same cap, same
    whitespace collapsing, same wording. Only --eval calls this: live mode's
    prompt is assembled in the Worker, which reads covers.headlines from D1
    itself. That is precisely why the copy has to stay identical, since --eval
    scoring a prompt production never sends measures nothing useful."""
    text = re.sub(r"\s+", " ", str(headlines or "")).strip()
    if not text:
        return ""

    clipped = (text[:HEADLINES_MAX_CHARS].rstrip() + "\u2026") if len(text) > HEADLINES_MAX_CHARS else text
    return (
        f"The titles printed on this page, scraped from the newspaper's own site, in page order:\n{clipped}\n\n"
        "That is every title on the page, the small side-rail and teaser ones included, not only "
        "the dominant story's. Read it to get the Portuguese wording right; which club is named "
        "most often in it does not decide the answer.\n\n"
    )


def rag_cover_ids_from_matches(matches):
    """Mirrors api/lib/ai.js's ragCoverIdsFromMatches exactly — same filter
    as build_few_shot_block above, kept as a separate pass for the same
    reason: --eval mode wants the text and never the ids. A match's own id
    is the cover_id build_vectorize_index.py upserted it under."""
    return [
        m["id"] for m in (matches or [])
        if m.get("score", 0) < 0.999 and m.get("metadata", {}).get("club")
    ]


def parse_answer(text):
    """Mirrors api/lib/ai.js's parseAnswer exactly: last ANSWER: marker
    wins, club matched by position in the text after it (not CLUBS order),
    an unreadable reply is no label rather than a guess."""
    raw = text or ""
    lower = raw.lower()
    marker = lower.rfind("answer:")
    if marker == -1:
        return {"club": None, "headline": None, "why": None}

    tail = lower[marker + len("answer:"):]
    club, at = None, len(tail) + 1
    for c in CLUBS:
        i = tail.find(c)
        if i != -1 and i < at:
            at, club = i, c

    before = raw[:marker]
    head = re.search(r"headline:\s*(.+)", before, re.IGNORECASE)
    why = re.search(r"why:\s*(.+)", before, re.IGNORECASE)
    return {
        "club": club,
        "headline": head.group(1).strip()[:200] if head else None,
        "why": why.group(1).strip()[:200] if why else None,
    }


def classify_via_llama(image_bytes, few_shot_text, headlines=None):
    b64 = base64.b64encode(image_bytes).decode("ascii")
    # Same order classifyCover uses: archive context, this page's own text,
    # then the instructions last, next to the image.
    prompt = few_shot_text + build_headlines_block(headlines) + PROMPT
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/ai/run/{MODEL}",
        data=json.dumps({
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                ],
            }],
            "max_tokens": 300,
            "temperature": 0.2,
        }).encode("utf-8"),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        result = json.loads(r.read())
    if not result.get("success"):
        raise RuntimeError(f"Llama4 call failed: {result.get('errors')}")
    return parse_answer(result.get("result", {}).get("response"))


def load_clip():
    print(f"loading {CLIP_MODEL_NAME}...")
    model = CLIPModel.from_pretrained(CLIP_MODEL_NAME, token=HF_TOKEN)
    processor = CLIPProcessor.from_pretrained(CLIP_MODEL_NAME, token=HF_TOKEN)
    model.eval()
    print("model loaded")
    return model, processor


def embed_and_retrieve(models, image_bytes, headlines=None, cover_date=None):
    """Both channels for one cover: the image against capas-cover-embeddings,
    the lead headline against capas-headline-embeddings, merged into one
    ranked list. No Llama4 call — /reclassify-rag is the one place that
    happens for a live cover, and calling it here too would pay for the same
    classification twice.

    A cover with no scraped headlines (every past-date scrape, see
    headlines.md) simply skips the text channel and gets image matches alone,
    which is what every cover got before this index existed.

    Returns (few_shot_text, cover_ids) — the ids are what run_live sends on as
    rag_cover_ids, for provenance; --eval only ever uses the text half."""
    clip, processor, text_model, tokenizer = models

    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    image_matches = usable_matches(
        query_vectorize(IMAGE_INDEX, embed(clip, processor, image), RAG_TOP_K + 3), "layout", cover_date,
    )

    headline_matches = []
    lead = lead_headline(headlines)
    if lead:
        headline_matches = usable_matches(
            query_vectorize(HEADLINE_INDEX, embed_text(text_model, tokenizer, lead), RAG_TOP_K + 3),
            "headline", cover_date,
        )

    merged = merge_channels(headline_matches, image_matches)
    return build_few_shot_block(merged), rag_cover_ids_from_matches(merged)


def rag_classify_one(models, image_bytes, headlines=None, cover_date=None):
    """Full pipeline for one cover: retrieve, build both prompt blocks,
    classify. Used by --eval only, which needs the result locally to score
    against the crowd label and never touches the Worker at all."""
    few_shot, _ = embed_and_retrieve(models, image_bytes, headlines, cover_date)
    result = classify_via_llama(image_bytes, few_shot, headlines)
    return result, few_shot


def run_live(models, limit):
    if not ADMIN_SECRET:
        print("Set ADMIN_SECRET (the Worker's admin bearer token, not a Cloudflare token).", file=sys.stderr)
        sys.exit(1)

    candidates = json.loads(fetch(
        f"{API_BASE}/rag-candidates?limit={limit}",
        headers={"Authorization": f"Bearer {ADMIN_SECRET}"},
    ))
    print(f"{len(candidates)} candidates")

    for c in candidates:
        try:
            image_bytes = fetch(c["url"])
            few_shot, rag_cover_ids = embed_and_retrieve(models, image_bytes, c.get("headlines"), c.get("date"))
        except Exception as e:
            print(f"  skip {c['newspaper']} {c['date']}: {e}", file=sys.stderr)
            continue

        # The Worker's env.AI.run call is the one and only Llama4 call for
        # this cover — classifyAndStore does the classification and the D1
        # write together, and hands the club back so this loop can report it.
        # rag_cover_ids is stored as-is (ai_rag_covers), not read back here —
        # it's provenance for later debugging, not something this loop uses.
        resp = json.loads(fetch(
            f"{API_BASE}/reclassify-rag",
            headers={"Authorization": f"Bearer {ADMIN_SECRET}", "Content-Type": "application/json"},
            data=json.dumps({
                "cover_id": c["id"], "r2_key": c["r2_key"], "few_shot": few_shot, "rag_cover_ids": rag_cover_ids,
            }).encode("utf-8"),
            method="POST",
        ))

        if not resp.get("club"):
            print(f"  {c['newspaper']} {c['date']}: no answer, skipped")
            continue

        tag = " (RAG)" if few_shot else " (no similar covers found)"
        print(f"  {c['newspaper']} {c['date']}: {resp['club']}{tag}")


def run_eval(models, n, all_):
    rows = json.loads(fetch(STATS))["rows"]
    # Two requests because they are two resources: /stats is the crowd labels,
    # /headlines is the scraped front-page text classifyAndStore reads from D1.
    # Scoring without the second one measures a prompt production never sends.
    headlines = {r["id"]: r["headlines"] for r in json.loads(fetch(f"{API_BASE}/headlines"))}
    labelled = [r for r in rows if r.get("club")]
    size = len(labelled) if all_ else min(n, len(labelled))
    sample = [labelled[int(i * len(labelled) / size)] for i in range(size)]

    matrix, misses, scored, abstained = {}, [], 0, 0
    print(f"{len(sample)} covers, {MODEL} + RAG few-shot\n")

    for i, row in enumerate(sample):
        try:
            image_bytes = fetch(row["url"])
            result, _ = rag_classify_one(models, image_bytes, headlines.get(row["cover_id"]), row.get("date"))
        except Exception as e:
            print(f"\nStopped at {i} of {len(sample)}: {e}", file=sys.stderr)
            break

        club = result["club"]
        if not club:
            abstained += 1
            continue

        scored += 1
        matrix.setdefault(row["club"], {})
        matrix[row["club"]][club] = matrix[row["club"]].get(club, 0) + 1
        if club != row["club"]:
            misses.append({**row, "ai": club, "headline": result["headline"]})

        sys.stdout.write("." if club == row["club"] else "x")
        sys.stdout.flush()

    if scored == 0:
        print("\nNothing scored.", file=sys.stderr)
        sys.exit(1)

    agreed = scored - len(misses)
    print(f"\n\nagreement  {agreed / scored * 100:.1f}%  ({agreed}/{scored})")
    if abstained:
        print(f"abstained  {abstained}  (no ANSWER: in the reply)")

    print("\nrecall by crowd label")
    for c in CLUBS:
        seen = sum(matrix.get(c, {}).values())
        if seen:
            hit = matrix[c].get(c, 0)
            print(f"  {c:<9} {hit / seen * 100:>3.0f}%  ({hit}/{seen})")

    print("\nconfusion  (down: crowd, across: model)")
    print("  " + "".ljust(9) + "".join(c[:5].rjust(7) for c in CLUBS))
    for c in CLUBS:
        print("  " + c.ljust(9) + "".join(str(matrix.get(c, {}).get(m, 0)).rjust(7) for m in CLUBS))

    if misses:
        print("\nmisses")
        for m in misses:
            print(f"  {m['date']} {m['newspaper']:<7} crowd={m['club']:<9} ai={m['ai']:<9} {m.get('headline') or ''}")


def main():
    if not ACCOUNT or not TOKEN:
        print("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Workers AI · Read, Vectorize · Read).", file=sys.stderr)
        sys.exit(1)

    ap = argparse.ArgumentParser()
    ap.add_argument("--eval", action="store_true", help="score against crowd labels instead of writing to D1")
    ap.add_argument("--limit", type=int, default=10, help="live mode: how many recent covers to reclassify")
    ap.add_argument("--n", type=int, default=40, help="--eval mode: sample size")
    ap.add_argument("--all", action="store_true", help="--eval mode: score every labelled cover")
    args = ap.parse_args()

    clip, processor = load_clip()
    text_model, tokenizer = load_text_model(HF_TOKEN)
    print("headline model loaded")
    models = (clip, processor, text_model, tokenizer)

    if args.eval:
        run_eval(models, args.n, args.all)
    else:
        run_live(models, args.limit)


if __name__ == "__main__":
    main()
