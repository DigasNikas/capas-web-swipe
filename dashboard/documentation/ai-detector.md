# AI Detector

The umbrella for the dashboard's "E a máquina, que diz?" card: what puts a
club next to each cover without a human vote. It's not one model call —
it's two tiers, run at different times, by different systems, stitched
together by `ai_club`/`ai_headline`/`ai_why` on the `covers` row. This page
is the map; [Multimodal](#multimodal), [RAG](#rag) and
[Image Embeddings](#image-embeddings) are where each tier is actually
implemented.

## The two tiers

1. **Multimodal, by default.** Every cover gets a zero-shot read from
   `@cf/meta/llama-4-scout-17b-16e-instruct` the moment it's scraped — see
   [Multimodal](#multimodal). No RAG context, no history, just the image
   and the prompt. This is what's on the card within minutes of a fresh
   cover landing.
2. **RAG, as the fallback.** Not a second opinion on every cover — only on
   the ones the zero-shot pass left unanswered. `classifyAndStore` writes
   `ai_club`/`ai_headline`/`ai_why` together or not at all, so
   `ai_club IS NULL` means exactly "the model didn't produce a parseable
   `ANSWER:` line," nothing else. `/rag-candidates` selects on that column
   alone, which is why a cover that already got a zero-shot label never
   becomes a RAG candidate — RAG exists to catch what the first pass
   missed, with a stronger prompt (few-shot context from visually similar,
   already-labelled covers — see [RAG](#rag)), not to re-grade what it
   already got.

So "AI Detector" isn't a single classifier; it's a first pass everything
goes through, plus a second pass reserved for the covers the first pass
gave up on.

## What runs when

| Step | Where | Trigger |
|---|---|---|
| Scrape a cover, zero-shot classify it | `scrapeNewspaper` → `classifyAndStore` (`api/lib/scraper.js`, `api/lib/ai.js`) | Worker's `scheduled()` cron, daily |
| Fire `scrape-completed` | `dispatchGithubEvent` (`api/lib/github.js`), called from `scheduled()` once every newspaper's scrape settles | End of the cron run |
| Reclassify whatever's still unlabelled | `scripts/rag_classify.py` → `/reclassify-rag` | `.github/workflows/rag-classify.yml`, `repository_dispatch: [scrape-completed]` |

The dispatch is what closes the loop without a human running the workflow
by hand: the Worker has no CLIP model to build RAG context with (see
[RAG](#rag)'s "Why outside the Worker" section), so the retry has to happen
outside it, and `repository_dispatch` is what tells GitHub Actions "now" is
"the moment the archive actually changed" instead of "whenever the next
cron tick happens to be." `/rag-candidates` capping each run and staying
self-converging (each `/reclassify-rag` call removes that cover from the
next run's set) is what keeps a daily automatic trigger from repeating the
quota incident described in [RAG](#rag)'s Quota section — see that section
for the numbers.

Both dispatches are best-effort: `dispatchGithubEvent` swallows its own
errors (logged, never thrown) so a GitHub API hiccup can't fail the request
or cron that triggered it. Unset `GH_DISPATCH_TOKEN` (`wrangler secret put
GH_DISPATCH_TOKEN`, a classic PAT with `repo` scope) and both dispatches are
silently skipped — the manual `workflow_dispatch` trigger on each workflow
still works, it just stops being automatic.

## How a cover ends up in the embeddings RAG reads from

RAG's few-shot context comes from `capas-cover-embeddings`
([Image Embeddings](#image-embeddings)), and that index only holds covers
with a crowd vote — an unvoted cover has no trustworthy label to attach to
its embedding. A cover reaches it one of two ways:

- **Its first vote**, live. `handleSwipe` (`api/handlers/swipes.js`) writes
  the swipe, refreshes `analytics_covers`, and — only the first time a
  cover gets a row there, not on every later vote — fires a
  `cover-first-vote` dispatch carrying the `cover_id`.
  `.github/workflows/vectorize-one-cover.yml` picks that up and runs
  `scripts/build_vectorize_index.py --cover-id <id>`: embed that one cover
  with CLIP, upsert that one vector. Nothing else in the index is touched.
That first-vote dispatch is the *only* automatic path into the index —
there's no scheduled full rebuild behind it. A dispatch that never lands
(`GH_DISPATCH_TOKEN` unset, a GitHub API hiccup) or a cover whose label
changes because a later vote flips the winning decision after its
first-vote embedding already went in just stays stale until someone
re-runs `build_vectorize_index.py` by hand — `vectorize-one-cover.yml`'s
own `workflow_dispatch` for one cover, or the script directly for a batch.
Vectorize's upsert overwrites by id, so any re-run is idempotent; the lag
until someone runs it is accepted, not silently fixed.

A cover is never embedded before it has a vote — that rule doesn't change
with any of this, only *when* an already-eligible cover actually makes it
into the index.

## Reading the card

`/api/stats` returns a `latestAi` block next to the crowd's own `latest`,
same verdict arithmetic, over `ai_club` instead of `club`. A paper the
model hasn't classified yet (either tier) is left out of that day's
verdict rather than counted as a miss — expect `latestAi` to be `null` or
thin for the first hour or so after a fresh day's covers land, before
either tier has had a chance to run. See [Multimodal](#multimodal) for the
card layout and the "where they disagree" browser underneath it.
