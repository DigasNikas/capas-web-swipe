#!/usr/bin/env python3
"""RAG-augmented cover reclassification: embed a cover with CLIP, retrieve
K similar labelled covers from Vectorize, fold their labels into the
Llama4 prompt as few-shot context, classify, and (in live mode) write the
result to D1 through the Worker's admin API.

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

PROMPT, MODEL, CLUBS, RAG_TOP_K and the few-shot block's exact wording are
copied from api/lib/ai.js rather than shared — Python can't import a JS
module. Keep both copies identical by hand; a mismatch here means this
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

import numpy as np
import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) capas-rag-classify/1.0"
CLIP_MODEL_NAME = "openai/clip-vit-base-patch32"
INDEX = "capas-cover-embeddings"
MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct"
CLUBS = ("benfica", "sporting", "porto", "others")
RAG_TOP_K = 5
STATS = os.environ.get("CAPAS_STATS", "https://capas.digasnikas.com/api/stats")
API_BASE = os.environ.get("CAPAS_API", "https://capas.digasnikas.com/api")
HF_TOKEN = os.environ.get("HF_TOKEN")  # optional: higher HF Hub rate limits, faster weight downloads

# Copied verbatim from api/lib/ai.js's PROMPT — keep in sync by hand.
PROMPT = (
    "You are looking at the front page of a Portuguese sports daily (Record, A Bola or O Jogo).\n"
    "Name the football club the page is MOSTLY about — the dominant headline and the main photo, "
    "the story that fills the page.\n"
    "\n"
    "Ignore these. They are on every edition and say nothing about the day:\n"
    "- the newspaper's own masthead and its colour (Record and A Bola are red; that is branding, not Benfica)\n"
    "- the small section boxes and side rails headed SPORTING, FC PORTO or BENFICA\n"
    "- teasers, adverts, cartoons and results bars along the edges\n"
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
    "HEADLINE: <the biggest headline, copied>\n"
    "WHY: <the one detail that decided it — a name, nickname or kit colour word from the headline or photo>\n"
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


def query_vectorize(vector):
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/vectorize/v2/indexes/{INDEX}/query",
        data=json.dumps({"vector": vector, "topK": RAG_TOP_K, "returnMetadata": "all"}).encode("utf-8"),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        result = json.loads(r.read())
    if not result.get("success"):
        raise RuntimeError(f"Vectorize query failed: {result.get('errors')}")
    return result["result"]["matches"]


def build_few_shot_block(matches):
    """Mirrors api/lib/ai.js's buildFewShotBlock exactly — same score
    filter (drops a cover's own near-identical match, score >= 0.999, so a
    re-classified cover never gets handed its own crowd vote), same
    wording. Keep both in sync by hand."""
    clubs = [
        m["metadata"]["club"] for m in (matches or [])
        if m.get("score", 0) < 0.999 and m.get("metadata", {}).get("club")
    ]
    if not clubs:
        return ""
    return (
        f"Reference: {len(clubs)} visually similar past front pages from this archive "
        f"were crowd-labelled: {', '.join(clubs)}. Visual similarity here tracks newspaper "
        "layout as much as subject matter — treat this only as a weak prior, not a verdict.\n\n"
    )


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


def classify_via_llama(image_bytes, few_shot_text):
    b64 = base64.b64encode(image_bytes).decode("ascii")
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/ai/run/{MODEL}",
        data=json.dumps({
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": few_shot_text + PROMPT},
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


def embed_and_retrieve(model, processor, image_bytes):
    """Embed and retrieve only, no Llama4 call — what live mode needs.
    /reclassify-rag is the one place that actually calls Llama4 for a live
    cover; calling classify_via_llama here too would mean paying for the
    same classification twice per cover. Returns few_shot_text."""
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    vector = embed(model, processor, image)
    matches = query_vectorize(vector)
    return build_few_shot_block(matches)


def rag_classify_one(model, processor, image_bytes):
    """Full pipeline for one cover: embed, retrieve, build few-shot text,
    classify. Used by --eval mode only, which needs the result locally to
    score against the crowd label and never touches the Worker at all.
    Returns (result_dict, few_shot_text)."""
    few_shot = embed_and_retrieve(model, processor, image_bytes)
    result = classify_via_llama(image_bytes, few_shot)
    return result, few_shot


def run_live(model, processor, limit):
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
            few_shot = embed_and_retrieve(model, processor, image_bytes)
        except Exception as e:
            print(f"  skip {c['newspaper']} {c['date']}: {e}", file=sys.stderr)
            continue

        # The Worker's env.AI.run call is the one and only Llama4 call for
        # this cover — classifyAndStore does the classification and the D1
        # write together, and hands the club back so this loop can report it.
        resp = json.loads(fetch(
            f"{API_BASE}/reclassify-rag",
            headers={"Authorization": f"Bearer {ADMIN_SECRET}", "Content-Type": "application/json"},
            data=json.dumps({"coverId": c["id"], "r2Key": c["r2_key"], "fewShot": few_shot}).encode("utf-8"),
            method="POST",
        ))

        if not resp.get("club"):
            print(f"  {c['newspaper']} {c['date']}: no answer, skipped")
            continue

        tag = " (RAG)" if few_shot else " (no similar covers found)"
        print(f"  {c['newspaper']} {c['date']}: {resp['club']}{tag}")


def run_eval(model, processor, n, all_):
    rows = json.loads(fetch(STATS))["rows"]
    labelled = [r for r in rows if r.get("club")]
    size = len(labelled) if all_ else min(n, len(labelled))
    sample = [labelled[int(i * len(labelled) / size)] for i in range(size)]

    matrix, misses, scored, abstained = {}, [], 0, 0
    print(f"{len(sample)} covers, {MODEL} + RAG few-shot\n")

    for i, row in enumerate(sample):
        try:
            image_bytes = fetch(row["url"])
            result, _ = rag_classify_one(model, processor, image_bytes)
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

    model, processor = load_clip()

    if args.eval:
        run_eval(model, processor, args.n, args.all)
    else:
        run_live(model, processor, args.limit)


if __name__ == "__main__":
    main()
