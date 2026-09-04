# Image Embeddings

A Vectorize index of cover images, so "covers that looked like this one" is a query instead of something a human has to eyeball. Not part of the AI Detector card and doesn't touch `ai_club`; a separate building block for similarity search over the archive.

The text sibling of this index is [Headline Embeddings](#headline-embeddings), which embeds each cover's lead headline instead of its pixels. Both feed the same few-shot block; this one is the channel with the layout bias described below.

## What's embedded

Every crowd-labelled cover, same filter as `avg_cover.py` and `train_classic_classifier.py`: a vote in `analytics_covers`. An unvoted cover has no trustworthy label, so there's nothing useful to attach to it.

## Model

CLIP (`openai/clip-vit-base-patch32`), run locally via `transformers`, not through a hosted API. HuggingFace's shared serverless Inference API has no clean REST route for raw image embeddings: HF staff confirmed on their own forums that CLIP's default pipeline there is zero-shot-image-classification, not feature-extraction. Local is the reliable option here, not a fallback: no external API, no token, no rate limit. The model is a public download (~600MB), no HF account needed.

One implementation snag worth knowing about: `get_image_features()` in this transformers version returns a full output object, not a bare tensor. The projected 512-dim embedding is `.pooler_output`; indexing the object directly lands on `last_hidden_state`, the pre-projection per-patch encoder output, shaped `(1, 50, 768)`, not what you want.

## Index

Vectorize index `capas-cover-embeddings`: 512 dimensions (matches CLIP's `projection_dim`), cosine metric. Dimensions and metric are fixed at creation and can't change later.

Metadata per vector: `club` (the crowd's vote), `newspaper`, `date`, `url`. Deliberately excludes `ai_club`: as of 2026-08-26 only 56 of 1,765 covers reflected the current prompt, the rest stale (an older prompt's leftover) or missing entirely, not a signal worth freezing into the index yet. Revisit once the backfill has actually caught the archive up.

## Running it

A cover's first vote is what makes it eligible, but the actual embedding run is batched rather than one-per-vote. `handleSwipe` fires a `cover-first-vote` dispatch the moment a cover gets its first crowd vote, not on later votes, and `.github/workflows/vectorize-covers.yml` runs `build_vectorize_index.py --candidates`, which pulls the *whole* backlog from `/vectorize-candidates` (every voted cover with `vectorized_at IS NULL`, self-converging the same way `/rag-candidates` is) and embeds it in one CLIP model load. A burst of votes still fires a burst of dispatches, but only the first run to actually start finds candidates; the rest see an empty backlog and exit before even loading CLIP. See [AI Detector](#ai-detector) for the trigger side.

`vectorized_at` is a real column now, not inferred from whether `analytics_covers` has a row (that only tells you a cover has a vote, not that it's actually in Vectorize; those two used to be conflated, which is exactly what let a burst of first-vote dispatches redundantly re-embed covers before this). It gets set once a batch upserts successfully, via `/vectorize-mark`, called from the script right after `upsert_batch` returns. A cover whose label changed because a later vote flipped the winning decision after its embedding already went in, or a cover whose dispatch never arrived (`GH_DISPATCH_TOKEN` unset, a GitHub API hiccup), stays stale until something re-triggers the workflow or someone reruns the script by hand. Vectorize's upsert overwrites by id, so any rerun is idempotent, an accepted lag rather than silent data loss.

To run by hand:

```bash
python3 -m venv .venv && .venv/bin/pip install numpy pillow torch transformers
CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… .venv/bin/python scripts/build_vectorize_index.py
... scripts/build_vectorize_index.py --cover-id 1234                    # one cover only
... ADMIN_SECRET=… scripts/build_vectorize_index.py --candidates 500    # the whole backlog
```

Needs a Cloudflare API token with **Vectorize · Write**, a separate permission from the **Workers AI · Read** scope `eval-ai.mjs` needs. `--candidates` additionally needs `ADMIN_SECRET` (the Worker's own bearer token, not a Cloudflare token), for `/vectorize-candidates` and `/vectorize-mark`. First run downloads CLIP's weights; after that it's CPU-bound and makes no external calls beyond fetching each cover from R2.

## Status

Populated: **1,564 vectors**, confirmed against the live index (`vectorCount: 1564`, `dimensions: 512`). A query using a cover's own embedding returns itself first (`score 0.9999988`), then mostly same-newspaper covers, with some cross-club and cross-newspaper matches mixed in: consistent with what the classic-classifier experiments already showed about what raw visual similarity picks up on (layout and masthead more than headline content).

[RAG](#rag) now reads from this index, not the Worker itself but
`scripts/rag_classify.py`, run outside the Worker via GitHub Actions. See
that chapter for the retrieval side and why.
