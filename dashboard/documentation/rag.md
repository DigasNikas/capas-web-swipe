# RAG

Nearest-neighbour retrieval from the two Vectorize indexes, folded into the classifier's prompt as a few-shot block. [Image Embeddings](#image-embeddings) finds covers that look like this page; [Headline Embeddings](#headline-embeddings) finds covers about the same story. [AI Detector](#ai-detector) covers the pipeline around it.

| | |
|---|---|
| Script | `scripts/rag_classify.py` |
| Workflow | `.github/workflows/rag-classify.yml`, serialised so two runs never share a candidate |
| Runs | GitHub Actions, never in the Worker. Triggered by a cover's first crowd vote, and by a cron dispatch for the backlog |
| Neighbours | `RAG_TOP_K = 7`, merged from both indexes |
| Consensus | `CONSENSUS_MIN = 6` of 7 agreeing neighbours skips the model |
| Writes via | `/reclassify-rag` (model call), `/label-consensus` (no model call), `/rag-matches` (retrieval only) |
| Columns | `ai_rag_covers`, `ai_rag_source`, `ai_source` |

## Retrieval

For each cover, `rag_classify.py`:

1. Embeds the image with CLIP and the lead headline with multilingual-e5-base, the same models that built the indexes. No headline, no text query.
2. Queries each index for `RAG_TOP_K + 3` matches.
3. Drops matches that must not reach the prompt (`usable_matches`):
   - score ≥ 0.999: the cover matching itself;
   - same date: the three papers print the same story that day in near-identical words;
   - no crowd label.
4. Relabels each match with its neighbour's current crowd label from `/api/stats`. Vector metadata is the label at embed time.
5. Merges the channels alternately, headline first, up to 7 (`merge_channels`). A cover found by both counts once, as a headline match.

The cover's own vectors are never written to the index here. Covers enter the indexes on their first crowd vote.

## Few-shot block

A tally of the merged neighbours' labels, with the channel split:

```
Reference: 7 past front pages from this archive were crowd-labelled:
4 benfica, 2 sporting, 1 others (4 matched by headline wording, 3 by page
layout). A headline match is about the same story; a layout match tracks
newspaper design as much as subject. Treat this only as a weak prior, not
a verdict.
```

`""` when no usable neighbour exists; the cover is still classified. `build_few_shot_block` (Python) and `buildFewShotBlock` (`api/lib/ai.js`) must stay identical by hand.

`ai_rag_covers` stores the neighbour ids and `ai_rag_source` the channel of each (`headline` or `layout`), in the same order. Nothing reads them back into a prompt. They power `/similarities` ("Parecidas") and trace a wrong label to the covers behind it.

## Consensus

When 6 or more of the 7 neighbours share a crowd label, `rag_classify.py` writes that label through `/label-consensus` and makes no model call. `ai_source = 'consensus'`, `ai_headline = ""`, and `ai_why` holds the margin ("6 of 7 similar covers were crowd-labelled porto"). `/label-consensus` re-checks the threshold server-side.

**Threshold replay**, measured when the threshold was set: this retrieval over all 1,836 crowd-labelled covers, neighbours' majority against the crowd.

| Winning bloc | Covers | Share | Agrees with crowd |
|---|---|---|---|
| 7 of 7 | 255 | 14% | 96% |
| 6 of 7 | 354 | 19% | 94% |
| 5 of 7 | 367 | 20% | 85% |
| 4 of 7 | 490 | 27% | 69% |
| 3 of 7 | 324 | 18% | 43% |

The bare neighbour majority, all bands: 75.3%.

**Live check**, classified covers to 2026-09-15, grouped by current crowd labels. "Shown" is the label the card displays (see [AI Detector](#ai-detector)). Two consensus covers fall to 5 of 7 after label corrections and are left out.

| Path | Neighbours agreeing | Covers | Neighbour majority right | Shown right |
|---|---|---|---|---|
| consensus | 7 of 7 | 60 | 100% | 100% |
| consensus | 6 of 7 | 60 | 98.3% | 98.3% |
| model | 5 of 7 | 45 | 86.7% | 97.8% |
| model | 4 of 7 | 47 | 70.2% | 83.0% |
| model | 3 of 7 | 25 | 48.0% | 84.0% |

Lowering the threshold to 5 would replace the model on those 45 covers: 86.7% instead of 97.8%.

## Modes

| Command | What it does | Workers AI |
|---|---|---|
| `rag_classify.py --limit N` | Classifies the newest N covers with `ai_club IS NULL` | Yes, except consensus covers |
| `rag_classify.py --date YYYY-MM-DD` | Same, for one cover day | Yes, except consensus covers |
| `rag_classify.py --matches-only --limit N` | Records neighbours (`ai_rag_covers`, `ai_rag_source`) without classifying | No |
| `rag_classify.py --eval --n 40` / `--all` | Scores the production prompt, both context blocks included, against crowd labels. Writes nothing | Yes, direct REST calls |

`--limit` defaults to 3 in the workflow. `/rag-candidates` selects newest first and caps a request at 50 covers (500 with `--matches-only`), so repeated runs work through a backlog. It returns a cover only once it has a crowd vote and its titles are stored, or if it is dated before today (see [AI Detector](#ai-detector)).

| Credential | Needed for |
|---|---|
| `ADMIN_SECRET` | `/rag-candidates`, `/reclassify-rag`, `/label-consensus`, `/rag-matches` |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` with **Vectorize · Read** | Queries. `--eval` also needs **Workers AI · Read** |
| `HF_TOKEN` (optional) | Faster weight download |

## Why outside the Worker

Workers AI has no CLIP-compatible image-embedding model. Three live alternatives failed:

| Option | Result |
|---|---|
| ONNX/WASM `@huggingface/transformers` in the Worker | Model download stalled at 18% and 83% in two attempts; multi-minute cold start even if it worked |
| Hugging Face hosted inference | No provider serves any CLIP-family model (`inferenceProviderMapping: {}`) |
| Self-hosted Hugging Face Space | `402 Payment Required`: creating a Docker or Gradio Space needs a paid Pro plan |

## Failures

`rag-classify.yml` is the only path to a label. If it fails, or a dispatch never arrives (`GH_DISPATCH_TOKEN` unset, GitHub API error), covers stay `ai_club IS NULL` until the next run — the cron dispatches one whenever anything classifiable is unlabelled, so recovery needs no one to notice. The next run picks them up from the backlog; nothing needs replaying day by day. A failed model call leaves the cover unlabelled for the next run.
