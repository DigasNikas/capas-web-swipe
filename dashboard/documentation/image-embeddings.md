# Image Embeddings

A Vectorize index of cover images, so "covers that looked like this one" is a query instead of something a human has to eyeball. Not part of the AI Detector card and doesn't touch `ai_club`; a separate building block for similarity search over the archive.

## What's embedded

Every crowd-labelled cover, same filter as `avg_cover.py` and `train_classic_classifier.py`: a vote in `analytics_covers`. An unvoted cover has no trustworthy label, so there's nothing useful to attach to it.

## Model

CLIP (`openai/clip-vit-base-patch32`), run locally via `transformers`, not through a hosted API. HuggingFace's shared serverless Inference API has no clean REST route for raw image embeddings: HF staff confirmed on their own forums that CLIP's default pipeline there is zero-shot-image-classification, not feature-extraction. Local is the reliable option here, not a fallback: no external API, no token, no rate limit. The model is a public download (~600MB), no HF account needed.

One implementation snag worth knowing about: `get_image_features()` in this transformers version returns a full output object, not a bare tensor. The projected 512-dim embedding is `.pooler_output`; indexing the object directly lands on `last_hidden_state`, the pre-projection per-patch encoder output, shaped `(1, 50, 768)`, not what you want.

## Index

Vectorize index `capas-cover-embeddings`: 512 dimensions (matches CLIP's `projection_dim`), cosine metric. Dimensions and metric are fixed at creation and can't change later.

Metadata per vector: `club` (the crowd's vote), `newspaper`, `date`, `url`. Deliberately excludes `ai_club`: as of 2026-08-26 only 56 of 1,765 covers reflected the current prompt, the rest stale (an older prompt's leftover) or missing entirely, not a signal worth freezing into the index yet. Revisit once the backfill has actually caught the archive up.

## Running it

**One cover, on its first vote**, automatically — the only path that writes to the index without someone triggering it. `handleSwipe` fires a `cover-first-vote` dispatch the moment a cover gets its first crowd vote (not on later votes), and `.github/workflows/vectorize-one-cover.yml` runs `build_vectorize_index.py --cover-id <id>` — embeds and upserts just that one vector. See [AI Detector](#ai-detector) for the trigger side.

There's no scheduled full rebuild anymore — a cover whose label changed because a later vote flipped the winning decision after its first-vote embedding already went in, or a cover whose dispatch never arrived (`GH_DISPATCH_TOKEN` unset, a GitHub API hiccup), stays stale in the index until someone re-runs this by hand: `vectorize-one-cover.yml`'s own `workflow_dispatch` for one cover, or the script directly for a batch. Vectorize's upsert overwrites by id, so any re-run is idempotent — accepted lag, not silent data loss.

To run either by hand:

```bash
python3 -m venv .venv && .venv/bin/pip install numpy pillow torch transformers
CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… .venv/bin/python scripts/build_vectorize_index.py
... scripts/build_vectorize_index.py --cover-id 1234   # one cover only
```

Needs a Cloudflare API token with **Vectorize · Write**, a separate permission from the **Workers AI · Read** scope `eval-ai.mjs` needs. First run downloads CLIP's weights; after that it's CPU-bound and makes no external calls beyond fetching each cover from R2.

## Status

Populated: **1,564 vectors**, confirmed against the live index (`vectorCount: 1564`, `dimensions: 512`). A query using a cover's own embedding returns itself first (`score 0.9999988`), then mostly same-newspaper covers, with some cross-club and cross-newspaper matches mixed in: consistent with what the classic-classifier experiments already showed about what raw visual similarity picks up on (layout and masthead more than headline content).

[RAG](#rag) now reads from this index — not the Worker itself, but
`scripts/rag_classify.py`, run on a schedule outside the Worker — see that
chapter for the retrieval side and why.
