# Headline Embeddings

One vector per crowd-labelled cover, embedded from the cover's lead headline. Answers "which past covers were about this story". Its sibling, [Image Embeddings](#image-embeddings), answers "which past covers looked like this page".

| | |
|---|---|
| Index | `capas-headline-embeddings`, 768 dimensions, cosine |
| Model | `intfloat/multilingual-e5-base` |
| Input | The lead headline from `covers.headlines` |
| Eligible covers | Every cover with a crowd vote and scraped `headlines` |
| Metadata | `club` (crowd vote at embed time), `newspaper`, `date` |
| Vectors | **1,672** (2026-09-15) |
| Progress column | `covers.headline_vectorized_at` |
| Builder | `scripts/build_headline_index.py` |
| Workflow | `.github/workflows/vectorize-headlines.yml` |

## Input

`lead_headline` (`scripts/headline_embeddings.py`) takes the first non-empty `•` segment of `covers.headlines`, strips markup, and caps it at 240 characters on a word boundary. The full string is every title on the page, rails and teasers included, which buries the lead story.

918 of 1,672 covers use the `•` separator. The other 754 came from the archive backfill as one unseparated run of titles, where the 240-character cap is the only cut.

On covers with a separator, the first segment is the headline the vision model reads off the largest photo 95% of the time. The crowd's club appears there 88% of the time it appears anywhere on the page.

## Model

multilingual-e5-base, run locally through `transformers`: mean pooling, L2-normalised, `"query: "` prefix on both sides, max 128 tokens.

Chosen on 1,446 covers when the index was built, by the same nearest-neighbour test as below:

| Model | Nearest neighbour | Top-5 majority |
|---|---|---|
| `paraphrase-multilingual-MiniLM-L12-v2` | 58.8% | 61.0% |
| `paraphrase-multilingual-mpnet-base-v2` | 60.4% | 63.0% |
| **`intfloat/multilingual-e5-base`** | **65.6%** | **69.8%** |
| Majority class | 33.2% | |

None of the three map nicknames to clubs (Águias → Benfica). A headline naming a club only by nickname retrieves poorly.

## Retrieval quality

Each cover's nearest other cover by cosine similarity, excluding covers from the same date. Accuracy is the share whose neighbour carries the same crowd label.

| Index | Covers | Nearest neighbour | Top-5 majority | `others` (nearest neighbour) | Neighbour from the same newspaper |
|---|---|---|---|---|---|
| Image | 1,866 | 65.3% | 68.0% | 36% | 84.5% |
| **Headline** | 1,672 | **66.9%** | **73.5%** | **54%** | **50.7%** |
| Always benfica / random newspaper | | 32.9% | | | 33.3% |

Per class, nearest neighbour: sporting 70%, benfica 71%, porto 68%, others 54%. Same-date exclusion matters here: the three papers print the same story on the same day in near-identical words.

## Filling the index

1. A cover's first crowd vote fires a `cover-first-vote` dispatch (`handleSwipe`).
2. The workflow runs `build_headline_index.py --limit 500`.
3. `GET /vectorize-candidates?index=headline` returns voted covers with `headlines IS NOT NULL` and `headline_vectorized_at IS NULL`.
4. The script embeds them and upserts in batches of 500.
5. `POST /vectorize-mark {index: "headline"}` sets `headline_vectorized_at`, only after the upsert succeeds.

The run takes the whole backlog, not the cover named in the dispatch. A burst of votes does the work once; later runs find an empty backlog. A missed dispatch is picked up by the next run. Upserts overwrite by id, so re-runs are safe.

```bash
.venv/bin/pip install numpy torch transformers
CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… ADMIN_SECRET=… \
  .venv/bin/python scripts/build_headline_index.py --limit 500   # backlog
```

| Credential | Needed for |
|---|---|
| `CLOUDFLARE_API_TOKEN` with **Vectorize · Write** | Upserts |
| `ADMIN_SECRET` | `/vectorize-candidates`, `/vectorize-mark` |
| `HF_TOKEN` (optional) | Faster weight download |

`.github/workflows/vectorize-prune.yml` deletes vectors by cover id (`index: headline`). Use it when a cover's `headlines` turn out to belong to another edition.

## Coverage

197 voted covers have no headline vector. 165 are from September and October 2025, editions for which capasjornais.pt publishes no headline block. The other 32 are scattered days with no headline block for that edition. These covers get image retrieval only, and no `others` gate score.

## Used by

- [RAG](#rag): the headline channel of the few-shot block, and the consensus check.
- The `others` gate: e5 vector, last 768 of its 1,280 features, computed at classify time. See [AI Detector](#ai-detector).
- [Classic Classifiers](#classic-classifiers), Experiment 2.
- `/similarities` ("Parecidas"): `ai_rag_source` records which channel found each neighbour, so the page can show one channel at a time.

The stored `club` is not read back. Retrieval takes each neighbour's current label from `/api/stats`, so a later vote that flips the winner needs no re-embed.
