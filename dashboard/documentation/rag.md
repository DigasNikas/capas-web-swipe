# RAG

K-nearest-neighbor retrieval from [Image Embeddings](#image-embeddings),
folded into the classifier's prompt as few-shot context. Runs outside the
Worker, in `scripts/rag_classify.py`, via
`.github/workflows/rag-classify.yml`, not live at scrape time. See
[AI Detector](#ai-detector): there's no separate zero-shot pass anymore,
this is the only place a cover gets classified at all now.

## What it does

`scripts/rag_classify.py` embeds a cover with the same CLIP model
`build_vectorize_index.py` used to build the index, queries
`capas-cover-embeddings` for the `RAG_TOP_K` (5) nearest labelled covers,
and prepends their crowd-labelled clubs to the prompt as a short reference
block, before the model reads the actual image. The block explicitly
names the caveat from [Image Embeddings](#image-embeddings): raw CLIP
similarity tracks newspaper layout as much as subject, so it reads as a
weak prior, not a verdict. The self-vote-leakage guard lives in this
function too (dropping a match with score ≥ 0.999, a cover matching
itself), so a cover already in the index never gets handed its own crowd
vote when reclassified.

Live mode stops there and POSTs the finished `fewShot` block, plus
`ragCoverIds`, to the Worker's `/reclassify-rag` admin endpoint, which does
the one and only Llama4 call for that cover through
`classifyAndStore`/`classifyCover`. `fewShot` is usually a populated block.
It comes back `""` only when no similar covers were found yet (a thin
archive, or a genuinely novel front page), and the cover still gets
classified, just without the reference context. This is deliberately not
called twice: `--eval` mode is the one exception, calling Llama4 directly
via the Workers AI REST API because it scores against the crowd label
locally and never touches the Worker at all. `api/lib/ai.js` itself never
touches Vectorize or does any embedding; that whole step happens in
Python, outside the Worker.

`ragCoverIds` is the same set of covers `fewShot`'s text was built from,
their ids instead of their clubs (`ragCoverIdsFromMatches` in `ai.js`,
`rag_cover_ids_from_matches` in `rag_classify.py`, same filter as the text
so the two never drift apart). `classifyAndStore` writes it straight to
`ai_rag_covers` as a JSON array alongside `ai_club`. Nothing reads that
column back to build a prompt; it exists so a bad classification can be
traced to the covers that biased it instead of re-deriving them by hand.

The new cover's own embedding is never written back to the index at this
point. It has no crowd vote yet, the same rule `build_vectorize_index.py`
already applies. The index keeps growing only through that script, on its
own schedule.

## Why outside the Worker, and why not a Space

Workers AI has no CLIP-compatible image-embedding model. Three live
embedding paths were tried and ruled out, in order.

1. In-Worker ONNX/WASM, `@huggingface/transformers` inside `wrangler dev`.
   Spiked directly, failed twice: one run errored after 7.5 minutes at 18%
   of the model download, a retry stalled at 83% for 15+ minutes and never
   finished. Even a successful run would mean a multi-minute cold start
   per isolate.
2. Hugging Face hosted inference, tested live against a real account
   token. No provider serves any CLIP-family model on any route
   (`inferenceProviderMapping: {}` on the Hub for every model tried).
3. A self-hosted HF Space (Docker + FastAPI), the original plan here.
   Blocked at creation time: as of 2026, Hugging Face requires a paid Pro
   subscription just to *create* a Docker or Gradio Space, even on the
   free CPU-basic tier (confirmed live: `402 Payment Required` on this
   account, which has no payment method on file). Not a code problem,
   nothing to build around.

`scripts/rag_classify.py` running on a schedule via GitHub Actions is what
was left: no live per-request embedding call, no external paid service,
no cold-start problem, and it matches this repo's existing automation
shape (`scrape.yml` already does the same thing for its own job).

## Failure handling

This used to be additive. A scrape-time zero-shot call gave every cover a
same-day label regardless, and RAG only ever upgraded what that pass left
blank. That call is gone now (see [AI Detector](#ai-detector)), so this
pipeline is load-bearing. If `rag-classify.yml` breaks, or the
`scrape-completed` dispatch that triggers it never lands
(`GH_DISPATCH_TOKEN` unset, a GitHub API hiccup), a cover just sits with
`ai_club IS NULL` until someone re-runs the workflow by hand. No fallback
kicks in on its own.

`/rag-candidates` staying self-converging is what makes that recoverable
instead of a growing backlog. Whenever the workflow does run again, it
picks up every cover still missing `ai_club`, not just the newest few, so
a stretch of missed days clears in a handful of runs rather than needing
to be replayed one day at a time.

## Quota

Classification calls Llama4 through the Workers AI free allowance (10,000
neurons/day). It's the only classification path now, so it's the only
thing drawing on that quota. An earlier unbounded backfill run once
starved it for a week (the zero-shot-only `backfill-ai` endpoint and its
daily workflow that caused that have since been removed; `rag_classify.py`
is the one classification mechanism now, not just the backfill one).

That history is why `rag-classify.yml` stayed `workflow_dispatch`-only for
a while rather than scheduled. It's no longer manual-only: the Worker
fires a `scrape-completed` `repository_dispatch` event once each day's
scrape finishes (see [AI Detector](#ai-detector)), which runs this
workflow with its default `--limit 10`, small and bounded on purpose, not
the unbounded shape that caused the earlier incident. `workflow_dispatch`
with a custom `limit` still works for a manual backlog run.

`/rag-candidates` selects covers still missing `ai_club`, newest first, up
to `limit` (capped at 50 server-side), self-converging: each successful
`/reclassify-rag` call removes that cover from the next call's set, so a
full backlog gets cleared by running this repeatedly (by hand, or the
workflow's own dispatch), not reprocessed from the top every time. Still
bounded per call on purpose, for the same quota reason: a full-archive
backfill is many small runs, not one `--limit 1700` shot.

## Two blocks, one prompt

`classifyCover` assembles `fewShot` + the cover's own scraped headlines +
`PROMPT`, in that order, with the instructions last so the reply-format
spec sits next to the image. The second block is `covers.headlines`, read
from D1 by `classifyAndStore` rather than sent in from here — see
[AI Detector](#ai-detector)'s "What the prompt carries" for how it's built
and for the guard sentence it carries.

Two scripts score prompts, and they measure different things.
`scripts/eval-ai.mjs` sends `PROMPT` alone, no few-shot block and no
headlines, and is the fixed baseline. `rag_classify.py --eval` sends what
production sends, both blocks included, reading the headline text from
`/stats?headlines=1` (opt-in on that endpoint, since the dashboard pulls
every row on load and reads none of it).
