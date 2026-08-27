# RAG

K-nearest-neighbor retrieval from [Image Embeddings](#image-embeddings),
folded into the zero-shot classifier's prompt as few-shot context. Runs
outside the Worker, in `scripts/rag_classify.py`, via
`.github/workflows/rag-classify.yml` — not live at scrape time. See
[AI Detector](#ai-detector) for how this fits together with the routine
zero-shot pass and what actually triggers this workflow now.

## What it does

`scripts/rag_classify.py` embeds a cover with the same CLIP model
`build_vectorize_index.py` used to build the index, queries
`capas-cover-embeddings` for the `RAG_TOP_K` (5) nearest labelled covers,
and prepends their crowd-labelled clubs to the prompt as a short reference
block — before the model reads the actual image. The block explicitly
names the caveat from [Image Embeddings](#image-embeddings): raw CLIP
similarity tracks newspaper layout as much as subject, so it reads as a
weak prior, not a verdict. The self-vote-leakage guard (dropping a match
with score ≥ 0.999 — a cover matching itself) lives in this function too,
so a cover already in the index never gets handed its own crowd vote when
reclassified.

Live mode stops there and POSTs the finished `fewShot` block to the
Worker's `/reclassify-rag` admin endpoint, which does the one and only
Llama4 call for that cover through `classifyAndStore`/`classifyCover` —
the same call the routine scrape-time path uses, just handed a pre-built
`fewShot` string instead of the `""` default. Deliberately not called
twice: `--eval` mode is the one exception that calls Llama4 directly via
the Workers AI REST API itself, because it scores against the crowd label
locally and never touches the Worker at all. `api/lib/ai.js` itself never
touches Vectorize or does any embedding — that whole step happens in
Python, outside the Worker.

The new cover's own embedding is never written back to the index at this
point — it has no crowd vote yet, same rule `build_vectorize_index.py`
already applies. The index keeps growing only through that script, on its
own schedule.

## Why outside the Worker, and why not a Space

Workers AI has no CLIP-compatible image-embedding model. Three live
embedding paths were tried and ruled out, in order:

1. **In-Worker ONNX/WASM** (`@huggingface/transformers` inside
   `wrangler dev`) — spiked directly, failed twice: one run errored after
   7.5 minutes at 18% of the model download, a retry stalled at 83% for
   15+ minutes and never finished. Even a successful run would mean a
   multi-minute cold start per isolate.
2. **Hugging Face hosted inference** — tested live against a real account
   token. No provider serves any CLIP-family model on any route
   (`inferenceProviderMapping: {}` on the Hub for every model tried).
3. **A self-hosted HF Space** (Docker + FastAPI) — the original plan here.
   Blocked at creation time: as of 2026, Hugging Face requires a paid Pro
   subscription just to *create* a Docker or Gradio Space, even on the free
   CPU-basic tier (confirmed live: `402 Payment Required` on this account,
   which has no payment method on file). Not a code problem — nothing to
   build around.

`scripts/rag_classify.py` running on a schedule via GitHub Actions is what
was left: no live per-request embedding call, no external paid service, no
cold-start problem, matches this repo's existing automation shape
(`scrape.yml` already does the same thing for its own job).

## Failure handling

The live scrape-time classification (`classifyAndStore`, called from
`scraper.js`) is completely unaffected by any of this — it always runs with
`fewShot = ""`, exactly today's plain zero-shot behavior. RAG only ever
touches a cover *after* it already has a baseline label, via the separate
scheduled reclassification pass. If that pass or the Space idea it replaced
ever breaks, the AI Detector section still gets same-day zero-shot labels
from the routine scrape — RAG is strictly additive, never load-bearing for
freshness.

## Quota

Reclassification calls Llama4 through the same Workers AI free allowance
(10,000 neurons/day) the routine scrape-time classification shares. An
earlier unbounded backfill run once starved that quota for a week (the
zero-shot-only `backfill-ai` endpoint and its daily workflow that caused
that have since been removed — `rag_classify.py` is the one
classification-backfill mechanism now).

That history is why `rag-classify.yml` stayed `workflow_dispatch`-only for
a while rather than scheduled. It's no longer manual-only: the Worker fires
a `scrape-completed` `repository_dispatch` event once each day's scrape
finishes (see [AI Detector](#ai-detector)), which runs this workflow with
its default `--limit 10` — small and bounded on purpose, not the unbounded
shape that caused the earlier incident. `workflow_dispatch` with a custom
`limit` still works for a manual backlog run.

`/rag-candidates` selects covers still missing `ai_club`, newest first, up
to `limit` (capped at 50 server-side) — self-converging: each successful
`/reclassify-rag` call removes that cover from the next call's set, so a
full backlog gets cleared by running this repeatedly (by hand, or the
workflow's own dispatch), not reprocessed from the top every time. Still
bounded per call on purpose, for the same quota reason above — a full-archive
backfill is many small runs, not one `--limit 1700` shot.

## Status

Built, not yet measured. `scripts/rag_classify.py --eval` is what answers
the real question — does the few-shot context move agreement% at all,
given the layout-not-subject bias already observed. Run it and compare
against a plain `scripts/eval-ai.mjs` run on the same sample, then update
this section with the result.
