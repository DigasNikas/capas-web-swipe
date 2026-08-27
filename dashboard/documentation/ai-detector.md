# AI Detector

The "E a máquina, que diz?" card runs one classifier, and it always runs
with the same context pipeline behind it, never bare. `ai_club`,
`ai_headline` and `ai_why` on the `covers` row hold the result.
[Multimodal](#multimodal), [RAG](#rag) and
[Image Embeddings](#image-embeddings) cover the mechanics; this page
covers how they connect.

## One pass, run after the scrape

A cover gets no opinion at scrape time. `scrapeNewspaper` stores it in D1
and stops. `ai_club` stays `NULL` until `scripts/rag_classify.py` picks it
up: embeds it, pulls the nearest labelled covers from Vectorize, and calls
Llama4 with that context folded into the prompt (see [RAG](#rag)).

There used to be a separate zero-shot call at scrape time, with RAG only
touching what that call missed. That call is gone. Every cover goes
through the RAG pass now. If the archive has nothing visually similar
yet, the few-shot block comes back empty and the model answers without a
reference, but the call still happens, on the same schedule as everything
else.

## What triggers what

Scraping happens in the Worker's daily `scheduled()` cron. Once every
newspaper's scrape for the day settles, that same handler calls
`dispatchGithubEvent` (`api/lib/github.js`) with a `scrape-completed`
event. GitHub Actions picks it up and runs
`.github/workflows/rag-classify.yml`, which calls
`scripts/rag_classify.py` against `/reclassify-rag` for whatever's still
missing a label.

The dispatch exists because the Worker can't build RAG context itself. It
has no CLIP model (see [RAG](#rag)'s "Why outside the Worker" section), so
classification has to run elsewhere, and `repository_dispatch` is what
tells GitHub Actions to run now instead of on the next cron tick.
`/rag-candidates` capping each call and staying self-converging (each
successful `/reclassify-rag` call removes that cover from the next call's
set) is what keeps a daily automatic trigger from repeating the quota
incident in [RAG](#rag)'s Quota section.

Both dispatches are best-effort. `dispatchGithubEvent` swallows its own
errors and logs them instead of throwing, so a GitHub API hiccup can't
fail the cron or the request that triggered it. Without `GH_DISPATCH_TOKEN`
set (`wrangler secret put GH_DISPATCH_TOKEN`, a classic PAT with `repo`
scope), both dispatches get skipped silently, and nothing gets classified
until someone runs `rag-classify.yml` by hand. That token carries more
weight than it used to: there's no fallback path behind it anymore.

## Getting into the embeddings index

RAG's few-shot context comes from `capas-cover-embeddings`
([Image Embeddings](#image-embeddings)), and that index only holds covers
with a crowd vote. An unvoted cover has no trustworthy label to attach to
its embedding.

A cover gets in on its first vote, and only its first vote. `handleSwipe`
(`api/handlers/swipes.js`) writes the swipe, refreshes `analytics_covers`,
and checks whether that was the cover's first row there. If it was, it
fires a `cover-first-vote` dispatch carrying the `cover_id`.
`.github/workflows/vectorize-one-cover.yml` picks that up and runs
`scripts/build_vectorize_index.py --cover-id <id>`: embed that one cover
with CLIP, upsert that one vector, touch nothing else in the index.

That's the only automatic path in. There's no scheduled rebuild behind it
anymore. A dispatch that never lands, or a cover whose label changes
because a later vote flips the winning decision after its first embedding
already went in, stays stale until someone re-runs
`build_vectorize_index.py` by hand, either through
`vectorize-one-cover.yml`'s own `workflow_dispatch` for one cover or the
script directly for a batch. Vectorize's upsert overwrites by id, so any
re-run is safe to repeat. The lag until someone actually runs it is a
known cost, not a bug waiting to be found.

## Reading the card

`/api/stats` returns a `latestAi` block next to the crowd's own `latest`,
same verdict math, over `ai_club` instead of `club`. A paper the model
hasn't classified yet is left out of that day's verdict rather than
counted as a miss. `latestAi` can come back `null` or thin for a while
after a fresh day's covers land, until the automatic reclassify run
catches up. [Multimodal](#multimodal) has the card layout and the "where
they disagree" browser underneath it.
