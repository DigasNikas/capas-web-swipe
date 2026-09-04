# Headline Embeddings

`capas-headline-embeddings` is the second Vectorize index: one 768-dim
vector per crowd-labelled cover, embedded from that cover's **lead
headline** rather than its image. It answers "which past covers were about
this story", where [Image Embeddings](#image-embeddings) answers "which
past covers looked like this page". Both feed the same few-shot block at
classify time (see [RAG](#rag)).

## Why a second index

Image similarity tracks newspaper layout as much as subject — that finding
is [Image Embeddings](#image-embeddings)' own, and it is why the few-shot
block has to disclaim itself in the prompt. Headline text has no such
problem: two covers whose lead stories share wording are about the same
thing.

It also plays to what the classifier is already doing. The benchmark at the
top of `api/lib/ai.js` shows full-resolution images beating thumbnails by 14
points, because these covers get called by their Portuguese text rather
than by kit colours.

## What gets embedded

The lead story's title only, not the whole `headlines` string.
`covers.headlines` is every title on the page, side rails and teasers
included — the things [AI Detector](#ai-detector)'s prompt spends four lines
telling the model to ignore. Embedding all of it buries the day's subject.

`lead_headline` (`scripts/headline_embeddings.py`) takes the first `•`
segment, strips the stray markup the archive backfill left behind, and caps
the result at 240 characters. The cap exists because only 790 of the 1451
covers with headlines use the `•` separator at all; the other 661 came
through the historical archive backfill as one unseparated run of titles,
where a character budget is the only cut available.

Taking the first segment is measured, not assumed. On the covers that have
a separator, the first segment is the headline the vision model reads off
the largest photo 95% of the time, and the crowd-labelled club appears
there 88% of the time it appears anywhere.

## The model

`intfloat/multilingual-e5-base`, run locally through plain `transformers`
(mean pooling, L2 normalize) — no `sentence-transformers` dependency, since
torch and transformers are already installed for CLIP. e5 wants a prefix on
its input; `"query: "` on both sides is the symmetric usage, headline
against headline rather than query against document.

Picked by measurement. Over the 1446 covers with both a lead headline and a
crowd label, asking each candidate model for the nearest *other* cover
(same date excluded) and reading that neighbour's crowd label:

| | nearest neighbour | top-5 majority |
|---|---|---|
| always guess the most common club | 33.2% | — |
| `paraphrase-multilingual-MiniLM-L12-v2` | 58.8% | 61.0% |
| `paraphrase-multilingual-mpnet-base-v2` | 60.4% | 63.0% |
| `intfloat/multilingual-e5-base` | 65.6% | 69.8% |

Read the ceiling as much as the ranking: a text neighbour agrees with the
crowd about two thirds of the time. That is a weak prior, which is what the
few-shot block calls it.

None of these models know that Águias means Benfica, so a cover headlined
purely by nickname retrieves badly. 94% of covers name the club outright,
which is why this works at all.

## Filling the index

`scripts/build_headline_index.py`, the same shape as
`build_vectorize_index.py`: `GET /vectorize-candidates?index=headline`
returns crowd-labelled covers with `headlines IS NOT NULL` and
`headline_vectorized_at IS NULL`, the script embeds and upserts them, then
`POST /vectorize-mark {index: "headline"}` marks each batch — only after the
upsert succeeds, so a failed batch stays in the backlog instead of being
marked done and dropped.

Both indexes share those two routes, keyed by `index=image` (the default,
so the older caller needs no change) or `index=headline`. The two progress
columns are separate (`vectorized_at`, `headline_vectorized_at`,
migration 0005) because the indexes fill independently: a cover is
embeddable as an image the moment it has a vote, but needs scraped text too
to enter this one.

Roughly a fifth of the archive will never enter this index, and that is not
a backlog. Past-date scrapes never set `headlines` (see
[Headlines](#headlines)), so those covers get image retrieval alone, which
is what every cover had before this existed.

`.github/workflows/vectorize-headlines.yml` runs it on the same
`cover-first-vote` dispatch as the image index, plus a manual trigger.

## Querying it

`scripts/rag_classify.py` embeds the cover being classified the same way and
queries both indexes, then merges. Two rules matter:

**Same-date matches are dropped.** Record, A Bola and O Jogo print the same
story on the same day in near-identical words, so an unfiltered text query
returns today's siblings and the prior collapses into copying the
neighbouring paper's crowd vote. The filter runs client-side on the
returned metadata, over-fetching a few, rather than as a Vectorize metadata
filter — that would need a metadata index created up front for no gain at
this size.

**The channels alternate, headline first**, up to `RAG_TOP_K` (5) total.
Headline first because it is the better prior; alternating rather than
filling from one channel keeps a cover with a thin headline index from
losing its image context. A cover both channels return appears once,
credited to the headline channel.

The block then says which channel found what, so the model can weigh a
story match above a layout match:

```
Reference: 5 past front pages from this archive were crowd-labelled:
2 benfica, 1 sporting, 1 porto, 1 others (3 matched by headline wording,
2 by page layout). A headline match is about the same story; a layout
match tracks newspaper design as much as subject. Treat this only as a
weak prior, not a verdict.
```
