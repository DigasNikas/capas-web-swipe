# RAG

K-nearest-neighbor retrieval from two indexes — [Image
Embeddings](#image-embeddings) for how the page looks, [Headline
Embeddings](#headline-embeddings) for what it says — folded into the
classifier's prompt as few-shot context. Runs outside the
Worker, in `scripts/rag_classify.py`, via
`.github/workflows/rag-classify.yml`, not live at scrape time. See
[AI Detector](#ai-detector): there's no separate zero-shot pass anymore,
this is the only place a cover gets classified at all now.

## What it does

`scripts/rag_classify.py` embeds a cover twice, with the same two models
that built the indexes: CLIP for the image, multilingual-e5-base for the
lead headline. Each index returns its nearest labelled covers, the two
result sets merge into `RAG_TOP_K` (7), and their crowd-labelled clubs go
in front of the prompt as a short reference block, before the model reads
the actual image.

The block is a tally rather than a list, and it says which channel found
what, because the two are worth different amounts: a headline match is
about the same story, while raw CLIP similarity tracks newspaper layout as
much as subject ([Image Embeddings](#image-embeddings)' own finding).
Both stay a weak prior, and the block says so.

Three rules keep the retrieval honest, all in `usable_matches` and
`merge_channels`. A match scoring ≥ 0.999 is the cover matching itself and
is dropped, so a reclassified cover never gets handed its own crowd vote. A
match from the same date is dropped, because the three papers print the
same story that day in near-identical words and the text channel would
otherwise just copy the neighbouring paper. And the channels alternate,
headline first, so a cover with a thin headline index keeps its image
context.

Live mode stops there and POSTs the finished few-shot block, plus the ids
it was built from, to the Worker's `/reclassify-rag` admin endpoint, which
does the one and only Llama4 call for that cover through
`classifyAndStore`/`classifyCover`. The block is usually populated; it comes
back `""` only when no similar covers were found yet (a thin
archive, or a genuinely novel front page), and the cover still gets
classified, just without the reference context. This is deliberately not
called twice: `--eval` mode is the one exception, calling Llama4 directly
via the Workers AI REST API because it scores against the crowd label
locally and never touches the Worker at all. `api/lib/ai.js` itself never
touches Vectorize or does any embedding; that whole step happens in
Python, outside the Worker.

Those ids are the same set of covers the few-shot text was built from,
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

## When the neighbours decide it themselves

Not every cover reaches Llama4. When `CONSENSUS_MIN` (6) or more of the
retrieved neighbours carry the same crowd label, `rag_classify.py` writes
that label through `/label-consensus` and never calls the model.

The threshold is measured, not chosen. Replaying this exact retrieval over
all 1836 crowd-labelled covers — both channels, self-matches and same-day
siblings dropped, merged to `RAG_TOP_K` — and scoring the neighbours' own
majority against the crowd, grouped by how big the winning bloc was:

| winning bloc | covers | share | agrees with the crowd |
|---|---|---|---|
| 7 of 7 | 255 | 14% | 96% |
| 6 of 7 | 354 | 19% | 94% |
| 5 of 7 | 367 | 20% | 85% |
| 4 of 7 | 490 | 27% | 69% |
| 3 of 7 | 324 | 18% | 43% |

6 is the cut because it is the last band that stays above the classifier's
own agreement (91.2% with both prompt blocks). At 6 the fast path answers a
third of covers at 95%, which is a third of the daily neuron allowance freed
for the rest. Dropping to 5 would answer half at 91% — a one-line change in
`api/lib/ai.js`, to be argued against that table.

None of this makes the neighbours a classifier. Their bare majority agrees
with the crowd 75.3% of the time, sixteen points below the model. This is a
shortcut on the covers where they happen to be near-unanimous, and nothing
more.

`ai_source` records which way each label came ('model' or 'consensus'), so
the two never have to be told apart by guessing. `ai_headline` is empty on a
consensus row, because nothing read the image; `ai_why` carries the margin
("6 of 7 similar covers were crowd-labelled porto") so a wrong one can be
traced to how thin its majority was. The threshold is re-checked inside
`/label-consensus` rather than trusted from the script, since a client bug
sending a 4-of-7 majority would otherwise write labels that are right 69% of
the time with nothing downstream noticing.

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
production sends, both blocks included, reading the crowd labels from
`/stats` and the headline text from `/headlines`.
