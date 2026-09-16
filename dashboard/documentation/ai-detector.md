# AI Detector

The "E a máquina, que diz?" card. Every classified cover gets a label from one of two paths, consensus or a model call. The `others` gate can then override a model label when the card is read. This page covers how the parts connect; [Multimodal](#multimodal), [RAG](#rag), [Image Embeddings](#image-embeddings) and [Headline Embeddings](#headline-embeddings) cover each part.

| | |
|---|---|
| Paths | Consensus (no model call) or Llama 4 Scout |
| Gate | Logistic regression over both embeddings, applied on read, `LR_GATE_THRESHOLD = 0.65` |
| Served by | `GET /api/detector` |
| Agreement shown | **93.7%** of 239 classified covers (2026-09-15) |

## Results

Covers from 2026-06-13 to 2026-09-15, against crowd labels, gate at 0.65.

| Path | Covers | Stored label right | Shown label right |
|---|---|---|---|
| Consensus | 122 | 120 (98.4%) | 120 (98.4%) |
| Model call | 117 | 94 (80.3%) | 104 (88.9%) |
| **All** | **239** | **214 (89.5%)** | **224 (93.7%)** |

Model calls by crowd label:

| Crowd label | Covers | Stored label right | Shown label right |
|---|---|---|---|
| benfica | 32 | 29 (91%) | 28 (88%) |
| sporting | 28 | 26 (93%) | 25 (89%) |
| porto | 28 | 27 (96%) | 26 (93%) |
| others | 29 | 12 (41%) | 25 (86%) |

> Agreement is with the crowd, not with ground truth. Most covers carry one vote.

## Pipeline

1. **Scrape.** The Worker cron runs at 05:00–08:00, 10:00 and 13:00 UTC. Every run does the same thing: store the cover if it is missing, fill today's titles once capasjornais.pt has turned over, do nothing when the row is settled. It then fires `classify-backlog` if any cover is classifiable and still unlabelled.
2. **First vote.** `handleSwipe` fires one `cover-first-vote` dispatch, which runs three workflows: both Vectorize indexes and `rag-classify.yml`. Classify runs are serialised, so a burst of votes cannot pay for the same model call twice.
3. **Candidates.** `rag_classify.py --limit 3` reads `/rag-candidates`: unlabelled covers that have a crowd vote and stored titles (or are dated before today).
4. **Retrieval.** The script embeds the image and the lead headline and pulls the 7 nearest labelled covers from both indexes ([RAG](#rag)).
5. **Consensus.** If 6 or more neighbours share a label, it is written through `/label-consensus`. Done, no model call.
6. **Gate score.** Otherwise the script scores the two vectors with `models/others_lr.json` (`scripts/lr_gate.py`).
7. **Model call.** `POST /reclassify-rag` sends the few-shot block, neighbour ids and gate scores. `classifyAndStore` reads the cover's titles from D1, builds the prompt, calls the model, and writes `ai_*` and `lr_*`.
8. **Read.** `/api/detector` applies the gate to model labels and returns what the card shows.

Classification runs on the vote because a cover reaches the card only once it has one: `/api/detector` reads `analytics_covers`. The cron dispatch is the safety net behind that — see [Dispatch](#ai-detector).

## Prompt context

`classifyCover` sends, in order:

| Block | Source | Built in |
|---|---|---|
| Few-shot block | Neighbour labels from both indexes | `rag_classify.py` |
| Page titles | `covers.headlines`, capped at 600 characters | Worker (`buildHeadlinesBlock`) |
| `PROMPT` | Instructions and reply format | `api/lib/ai.js` |
| Image | Full-resolution cover from R2 | Worker |

The instructions come last, next to the image. The titles block carries a guard sentence: it lists every title on the page, side rails included, and must not be read as a count of club mentions. A cover with `headlines IS NULL` gets no titles block.

## The `others` gate

The model names a club on most pages the crowd calls `others`: 12 of 29 right on model-classified covers. The gate corrects that one error, on read, without changing the stored label.

**Rule** (`api/lib/gate.js`). The shown label becomes `others` when all of these hold:

- the label came from a model call, not consensus;
- the model named a club;
- `OWNS` is `yes`;
- `lr_others ≥ LR_GATE_THRESHOLD`.

Otherwise the shown label is `ai_club`. The gate never turns `others` into a club, and never swaps one club for another. Covers without gate scores are never gated.

**Model.** Multinomial logistic regression over the CLIP vector (512) concatenated with the e5 headline vector (768), standardised. Walk-forward out-of-fold accuracy over 1,402 covers: 81.2%. Image alone: 70.0%. Headline alone: 66.0%.

**Threshold sweep**, 239 classified covers, via `/api/detector?threshold=`:

| Threshold | Gated | Right | Wrong | Agreement shown | Disagreements |
|---|---|---|---|---|---|
| no gate | 0 | | | 89.5% | 25 |
| 0.50 | 18 | 13 | 5 | 92.9% | 17 |
| 0.60–0.70 | 16 | 13 | 3 | **93.7%** | **15** |
| 0.75 | 15 | 12 | 3 | 93.3% | 16 |
| 0.80 | 13 | 11 | 2 | 93.3% | 16 |
| 0.85–0.90 | 10 | 9 | 1 | 92.9% | 17 |
| 0.95 | 8 | 8 | 0 | 92.9% | 17 |
| 0.99 | 6 | 6 | 0 | 92.1% | 19 |

**`OWNS` condition.** On these covers `OWNS` was `yes` on every cover where the model named a club, so it changes no result at any threshold. It stays as a safeguard: a missing `OWNS` never fires the gate.

**Operation.**

| | |
|---|---|
| Threshold | Worker secret `LR_GATE_THRESHOLD`. Unset means no gate. Takes effect on the next request, including for past covers |
| Change it | `printf '0.8' \| npx wrangler secret put LR_GATE_THRESHOLD` |
| Try one without changing it | `/api/detector?threshold=0.8` |
| Weights | `models/others_lr.json`, fitted on every labelled cover with both vectors |
| Refit | `.github/workflows/refit-lr.yml`, monthly and on demand. Commits the weights; fails if the Python scorer disagrees with sklearn. Prospective: new weights reach covers classified after the refit, never past ones |
| Re-score past covers | `scripts/backfill_lr_probabilities.py`, which emits SQL to review and apply by hand. The only way a refit reaches covers already classified |

**No gate score.** Consensus covers (no model answer to override) and covers without a headline vector.

**Stored, not recomputed.** `/api/detector` reads each cover's `lr_others`; it never loads the weights. Only `LR_GATE_THRESHOLD` is retroactive.

## Titles first

A cover is not a candidate until `covers.headlines` is stored. Classified without it, a cover gets no titles block in the prompt, retrieval on the image channel alone, and no gate score — and nothing revisits a cover once `ai_club` is set.

Covers dated before today are exempt: capasjornais.pt serves titles for today only, so waiting would mean never classifying them.

## Where they disagree

A button under the card opens every cover whose shown label differs from the crowd's: 15 at threshold 0.65. A month picker, then that month's covers with both labels as colour blocks; a gated cover shows `RES` as its AI label. Built from the `/api/detector` response already loaded, no extra request.

## Dispatch

Two events, one workflow set.

| Event | Fired by | When |
|---|---|---|
| `cover-first-vote` | `handleSwipe` | A cover's first crowd vote |
| `classify-backlog` | Worker cron, after each scrape | Any cover is classifiable and unlabelled |

| Workflow | Event | Does |
|---|---|---|
| `vectorize-covers.yml` | `cover-first-vote` | Embeds the backlog into `capas-cover-embeddings` |
| `vectorize-headlines.yml` | `cover-first-vote` | Embeds the backlog into `capas-headline-embeddings` |
| `rag-classify.yml` | both | Classifies the newest 3 candidates |

`cover-first-vote` alone leaves a hole: a cover voted on before its titles arrive is not classifiable at that moment, and nothing comes back for it. The cron closes it. `hasClassifiableCovers` asks through the same `CLASSIFIABLE` predicate `/rag-candidates` filters on, so the two cannot disagree, and no dispatch is fired when there is nothing to do.

Classification is vote-driven throughout: an unvoted cover is never a candidate, because `/api/detector` joins `analytics_covers` and would not show it anyway.

While the archive backlog lasts, that condition is true on every cron: six runs a day, 3 covers each, ~1,200 neurons.

Each workflow reads its whole backlog, not the `cover_id` in the payload, so a missed dispatch is picked up by the next one. `GH_DISPATCH_TOKEN` (a Worker secret: classic PAT, `repo` scope) is required; without it dispatches are skipped silently and nothing is embedded or classified until a workflow is run by hand. `dispatchGithubEvent` never throws.

## Columns

| Column | Written by | Content |
|---|---|---|
| `ai_club` | `/reclassify-rag`, `/label-consensus` | Model answer or consensus label. Never changed by the gate |
| `ai_source` | same | `model` or `consensus` |
| `ai_owns` | `/reclassify-rag` | `yes` / `no` |
| `ai_headline` | same | Headline the model quoted; `""` on consensus |
| `ai_why` | both | Model's reason, or the consensus margin |
| `ai_rag_covers`, `ai_rag_source` | both, `/rag-matches` | Neighbour ids and their channels |
| `lr_benfica`, `lr_porto`, `lr_sporting`, `lr_others` | `/reclassify-rag`, backfill | Gate probabilities |
| `lr_asof` | same | Newest cover date in the weights' training data (live), or the fold's training cutoff (backfill) |

## `/api/detector`

Every classified cover with `club` (shown), `model_club` (`ai_club`), `source` (`model`, `consensus` or `gate`), `human_club`, `headline`, `why`, `owns` and `lr`. Top level: `threshold`, `labelled`, `agreement`, `gated`, and `latest`, the newest day's verdict over its classified covers. Not edge-cached. `?threshold=` overrides the secret for that response only.
