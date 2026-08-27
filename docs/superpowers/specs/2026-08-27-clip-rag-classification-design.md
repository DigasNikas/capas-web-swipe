# CLIP-RAG Cover Classification — Design

> **Revision (2026-08-27, same day):** The chosen path below — a
> self-hosted HF Space — turned out not to be buildable: creating a new
> Docker/Gradio Space on Hugging Face now requires a paid Pro subscription,
> confirmed live (`402 Payment Required`) against an account with no
> payment method on file. The investigation into Workers AI, in-Worker
> ONNX/WASM, and HF's hosted inference below is unchanged and still the
> reason those three are ruled out. What replaced the Space: no live
> per-request embedding at all. `scripts/rag_classify.py`, run on a
> schedule via GitHub Actions (`.github/workflows/rag-classify.yml`), does
> the embedding + Vectorize retrieval + Llama4 call entirely outside the
> Worker, and writes results back through a new admin endpoint
> (`/reclassify-rag`) instead of the Worker embedding covers itself. See
> `dashboard/documentation/rag.md` for the as-built version of this
> chapter — treat this file as a historical record of what was tried, not
> the current architecture.

## Goal

Improve the zero-shot Llama4 club classifier (`api/lib/ai.js`) by grounding
each classification in visually similar past covers, retrieved live from the
existing `capas-cover-embeddings` Vectorize index. Matches the roadmap in
memory `ai-detector-ensemble-roadmap`: K nearest labelled covers as dynamic
few-shot examples, never a cover's own crowd vote fed into its own
classification.

## Background — what's already established

- Vectorize index `capas-cover-embeddings` (512-dim, cosine) already holds
  1,564 crowd-labelled cover embeddings, built by `scripts/build_vectorize_index.py`
  using CLIP (`openai/clip-vit-base-patch32`) run locally via `transformers`.
  Nothing reads from the index yet.
- A new, unclassified cover has no embedding of its own — one has to be
  computed at classification time, in the same vector space as the index, or
  the k-NN query is meaningless.
- Three embedding options were evaluated this session and ruled out:
  1. **Workers AI binding** — no CLIP-compatible image-embedding model in the
     catalog (confirmed against current docs).
  2. **In-Worker ONNX/WASM** (`@huggingface/transformers` + `onnxruntime-web`
     inside a Cloudflare Worker) — spiked directly with `wrangler dev`.
     Failed twice: first attempt errored after 7.5 min at 18% of the 90MB
     model download; second attempt (single-threaded WASM forced) stalled at
     83% for 15+ minutes and never completed. Even a successful run would
     mean a multi-minute cold start per isolate — not viable for a
     request-scoped path regardless of the compatibility question.
  3. **Hugging Face hosted inference** — tested live against the account's
     real token. `api-inference.huggingface.co` (legacy) no longer resolves.
     The current router (`router.huggingface.co/hf-inference/models/.../pipeline/feature-extraction`)
     returned `400 Model not supported by provider hf-inference` for every
     CLIP-family model tried (`openai/clip-vit-base-patch32`,
     `sentence-transformers/clip-ViT-B-32`, `jinaai/jina-clip-v2`,
     `jinaai/jina-clip-v1`). The Hub's own `inferenceProviderMapping` for
     jina-clip-v2 is `{}` — no provider serves it, confirmed via the Hub API,
     not inferred from docs.
- **Chosen path**: self-host a small CLIP-embedding service on a free-tier
  Hugging Face Space (Docker + FastAPI). The Worker calls it synchronously at
  classification time. This is the only path that gives a live, per-cover
  embedding without local Python in the request loop.

## Architecture

```
scrape (cron, Worker)
  → cover image already fetched, stored in R2 (unchanged)
  → classifyAndStore(env, coverId, r2Key)
      → embedCover(env, buffer)              [NEW]
          POST image bytes → HF Space /embed  (X-Api-Key header)
          → 512-dim vector, or null on any failure (timeout/cold/down)
      → if vector: env.VECTORIZE.query(vector, {topK: 5, returnMetadata: true})  [NEW]
          → K nearest *labelled* covers, each with metadata.club
      → buildFewShotBlock(matches)            [NEW]
          → short text block, or "" if no matches / no embedding
      → env.AI.run(Llama4, PROMPT_with_fewshot_prefix + image)   [existing call, augmented prompt]
      → parseAnswer(...)                      [unchanged]
      → write ai_club / ai_headline / ai_why to D1   [unchanged]
```

Key property: every new step is additive and fails soft. If the Space is
cold, down, or unauthorized, `embedCover` returns `null`, the few-shot block
is `""`, and the prompt sent to Llama4 is byte-for-byte what it is today.
`classifyAndStore`'s existing "never throws" contract is preserved — a
Vectorize or Space outage degrades to today's plain zero-shot behavior, it
never blocks the daily scrape.

The new cover's own vector is **query-only** — it is never upserted into the
index at classification time, because it has no crowd vote yet (same rule
`build_vectorize_index.py` already applies: an unvoted cover has no
trustworthy label). The Python batch script remains the only writer to the
index, unchanged, and will pick the cover up once it has votes.

## Components

### 1. HF Space (`clip-space/`)

A minimal Docker Space, not part of the Cloudflare Worker bundle.

- `app.py` — FastAPI app. Loads `CLIPModel`/`CLIPProcessor` once at import
  time (module scope, not per-request). One route:
  - `POST /embed` — body is raw image bytes (any `Content-Type: image/*`),
    header `X-Api-Key` must match the `SPACE_API_KEY` env var (a Space
    secret). Returns `{"embedding": [512 floats]}`. `401` on bad/missing key,
    `400` on an unparseable image.
  - `GET /` — trivial health check (`{"status": "ok"}`), also what stops the
    Space showing as broken in the HF UI.
  - The embedding logic (preprocess → `get_image_features()` →
    `.pooler_output` → L2-normalize) is copied verbatim from
    `scripts/build_vectorize_index.py`'s `embed()` — same model, same
    preprocessing, same normalization. Any drift here silently skews cosine
    similarity against the existing index; this is the one thing that must
    stay identical, not "close."
- `requirements.txt` — `fastapi`, `uvicorn`, `torch` (CPU wheel),
  `transformers`, `pillow`, `numpy`, `python-multipart`.
- `Dockerfile` — `python:3.11-slim`, installs requirements, runs
  `uvicorn app:app --host 0.0.0.0 --port 7860` (7860 is the Spaces Docker
  SDK convention).
- `README.md` — Spaces YAML frontmatter (`sdk: docker`, `app_port: 7860`)
  plus one line saying what this is and pointing back at this repo.
- `test_embed.py` — self-check per this session's "leave a runnable check"
  rule: builds a tiny synthetic RGB image in memory with Pillow, runs it
  through the same `embed()` function the app uses, asserts the output is a
  512-length vector with L2 norm ≈ 1. Run with `python3 clip-space/test_embed.py`.
  No network, no FastAPI server needed — it exercises the model logic
  directly.

Deploying this Space (creating it on huggingface.co, `git push` to it,
setting the `SPACE_API_KEY` secret) is a manual step for Diogo — it needs an
HF account action this session has no credentials for. The plan produces the
ready-to-push code; the deploy command is documented, not executed here.

### 2. `wrangler.toml`

Add a Vectorize binding (none exists today):

```toml
[[vectorize]]
binding    = "VECTORIZE"
index_name = "capas-cover-embeddings"
```

### 3. `api/lib/ai.js`

- `PROMPT` stays exported and unchanged — it remains the zero-shot baseline
  `scripts/eval-ai.mjs` scores against.
- New: `RAG_TOP_K = 5` — how many neighbors to pull. 5 is a starting point:
  enough to show a majority signal, small enough not to bloat the prompt.
- New: `async function embedCover(env, buffer)` — POSTs to
  `env.CLIP_SPACE_URL` with header `X-Api-Key: env.CLIP_SPACE_KEY`, an
  `AbortController` timeout (8s — a cold Space can take a while, but this
  must not stall the scrape past reason), returns the embedding array or
  `null` on any failure. Never throws.
- New: `function buildFewShotBlock(matches)` — takes Vectorize
  `matches` (array of `{metadata: {club, ...}}`), returns a short text block
  naming the labels found, or `""` if `matches` is empty. Explicitly states
  the known caveat from `image-embeddings.md` (raw CLIP similarity tracks
  newspaper layout more than subject) so the model treats it as a weak
  prior, not a verdict:

  ```
  Reference: N visually similar past front pages from this archive were
  crowd-labelled: <club>, <club>, ... Visual similarity here tracks
  newspaper layout as much as subject — treat this only as a weak prior.
  ```

- `classifyCover` changes: embed → query Vectorize (both wrapped so any
  failure just yields `""`) → prepend the few-shot block to `PROMPT` →
  send to `env.AI.run` exactly as today. `parseAnswer` and the D1 write are
  untouched.
- File-header env var block updated (`VECTORIZE` binding, `CLIP_SPACE_URL` /
  `CLIP_SPACE_KEY` vars), matching the existing documented-header convention
  in `api/index.js`.

### 4. `scripts/eval-ai.mjs`

New `--rag` flag. Without it, behavior is identical to today (pure zero-shot
baseline). With it: for each sampled cover, additionally call the Space to
embed the image and query Vectorize via its REST API (same
account/token pattern `build_vectorize_index.py` already uses for `upsert`,
here a `query` call — needs a token with **Vectorize · Read**, documented
in the script header alongside the existing **Workers AI · Read**
requirement), build the same few-shot block via the imported
`buildFewShotBlock`, and score the RAG-augmented prompt instead of the bare
one. This is the artifact that answers the real question — does the few-shot
context actually raise agreement%, or does the layout-not-subject bias in
`image-embeddings.md` mean it doesn't move the needle — matching this
project's own stated rule that a prompt change is judged by this script, not
by eye.

### 5. Docs

`dashboard/documentation/rag.md` (currently a placeholder) gets rewritten to
describe the built pipeline, once it exists — mirrors how
`image-embeddings.md` documents real, running state rather than a forward
plan. Written last, after the code lands, so it states what's actually true
(built vs. deployed vs. measured) rather than aspirational status.

## Testing

- `clip-space/test_embed.py` — self-check for the embedding logic (see above).
- `api/lib/ai.test.mjs` — extend with cases for `buildFewShotBlock`: empty
  matches → `""`, matches with metadata → correct club list and caveat text
  present, matches with missing/null `metadata.club` filtered out.
- `scripts/eval-ai.mjs --rag` vs. plain `scripts/eval-ai.mjs` on the same
  sample — the real acceptance test: does agreement% improve. This has to be
  run against the live deployed Space + Vectorize binding, by Diogo, after
  deploy — it is not something this session can execute end-to-end without
  the Space existing and secrets being set.

## Out of scope

- Upserting a newly-classified cover into the Vectorize index — stays a job
  for the existing offline `build_vectorize_index.py`, unchanged.
- Any change to the classic-classifier ensemble idea from the roadmap memory
  — this spec is the Vectorize half only.
- Space autoscaling / GPU tier — free CPU tier is sufficient for a single
  ViT-B/32 forward pass; revisit only if latency becomes a real problem.
