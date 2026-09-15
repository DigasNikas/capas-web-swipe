# Image Embeddings

One vector per crowd-labelled cover, embedded from the cover image. Answers "which past covers looked like this page". Its sibling, [Headline Embeddings](#headline-embeddings), answers "which past covers were about this story".

| | |
|---|---|
| Index | `capas-cover-embeddings`, 512 dimensions, cosine |
| Model | `openai/clip-vit-base-patch32` |
| Input | The full-resolution cover image |
| Eligible covers | Every cover with a crowd vote |
| Metadata | `club` (crowd vote at embed time), `newspaper`, `date`, `url` |
| Vectors | **1,866** (2026-09-15) |
| Progress column | `covers.vectorized_at` |
| Builder | `scripts/build_vectorize_index.py` |
| Workflow | `.github/workflows/vectorize-covers.yml` |

## Input

The cover image from R2, as scraped. No crop or resize before CLIP's own preprocessing.

## Model

CLIP ViT-B/32, run locally through `transformers`. No hosted API: HuggingFace's serverless Inference API serves CLIP as zero-shot classification, not feature extraction. The weights are a public ~600MB download.

The embedding is `get_image_features(...).pooler_output`, the 512-dim projection. Indexing the output object directly returns `last_hidden_state`, shaped `(1, 50, 768)`, which is the wrong tensor.

## Retrieval quality

Each cover's nearest other cover by cosine similarity, excluding covers from the same date. Accuracy is the share whose neighbour carries the same crowd label.

| Index | Covers | Nearest neighbour | Top-5 majority | `others` (nearest neighbour) | Neighbour from the same newspaper |
|---|---|---|---|---|---|
| **Image** | 1,866 | **65.3%** | **68.0%** | **36%** | **84.5%** |
| Headline | 1,672 | 66.9% | 73.5% | 54% | 50.7% |
| Always benfica / random newspaper | | 32.9% | | | 33.3% |

Per class, nearest neighbour: sporting 72%, benfica 74%, porto 69%, others 36%. 84.5% of nearest neighbours come from the same newspaper: the index tracks layout and masthead as much as subject.

## Filling the index

1. A cover's first crowd vote fires a `cover-first-vote` dispatch (`handleSwipe`).
2. The workflow runs `build_vectorize_index.py --candidates 500`.
3. `GET /vectorize-candidates?index=image` returns voted covers with `vectorized_at IS NULL`.
4. The script embeds them and upserts in batches of 500.
5. `POST /vectorize-mark {index: "image"}` sets `vectorized_at`, only after the upsert succeeds.

The run takes the whole backlog, not the cover named in the dispatch. A burst of votes does the work once; later runs find an empty backlog. A missed dispatch is picked up by the next run. Upserts overwrite by id, so re-runs are safe.

```bash
.venv/bin/pip install numpy pillow torch transformers
CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… ADMIN_SECRET=… \
  .venv/bin/python scripts/build_vectorize_index.py --candidates 500   # backlog
... scripts/build_vectorize_index.py --cover-id 1234                   # one cover
... scripts/build_vectorize_index.py --limit 50                        # newest 50 voted covers
```

| Credential | Needed for |
|---|---|
| `CLOUDFLARE_API_TOKEN` with **Vectorize · Write** | Upserts |
| `ADMIN_SECRET` | `/vectorize-candidates`, `/vectorize-mark` |
| `HF_TOKEN` (optional) | Faster weight download |

`.github/workflows/vectorize-prune.yml` deletes vectors by cover id (`index: image`).

## Used by

- [RAG](#rag): the layout channel of the few-shot block, and the consensus check.
- The `others` gate: CLIP vector, first 512 of its 1,280 features, computed at classify time. See [AI Detector](#ai-detector).
- [Classic Classifiers](#classic-classifiers), Experiment 2.

The stored `club` is not read back. Retrieval takes each neighbour's current label from `/api/stats`, so a later vote that flips the winner needs no re-embed.
