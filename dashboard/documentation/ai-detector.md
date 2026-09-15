# AI Detector

The "E a máquina, que diz?" card. Every classified cover gets a label from one of two paths, consensus or a model call. The `others` gate can then override a model label when the card is read. This page covers how the parts connect; [Multimodal](#multimodal), [RAG](#rag), [Image Embeddings](#image-embeddings) and [Headline Embeddings](#headline-embeddings) cover each part.

| | |
|---|---|
| Paths | Consensus (no model call) or Llama 4 Scout |
| Gate | Logistic regression over both embeddings, applied on read, `LR_GATE_THRESHOLD = 0.65` |
| Served by | `GET /api/detector` |
| Agreement shown | **93.7%** of 239 classified covers (2026-09-15) |

## Pipeline

1. **Scrape.** The Worker cron runs hourly 05:00–08:00 UTC. `scrapeNewspaper` stores each cover; no label yet. After each run it fires a `scrape-completed` dispatch.
2. **Candidates.** `rag-classify.yml` runs `rag_classify.py --limit 3`, which reads covers with `ai_club IS NULL`, newest first, from `/rag-candidates`.
3. **Retrieval.** The script embeds the image and the lead headline and pulls the 7 nearest labelled covers from both indexes ([RAG](#rag)).
4. **Consensus.** If 6 or more neighbours share a label, it is written through `/label-consensus`. Done, no model call.
5. **Gate score.** Otherwise the script scores the two vectors with `models/others_lr.json` (`scripts/lr_gate.py`).
6. **Model call.** `POST /reclassify-rag` sends the few-shot block, neighbour ids and gate scores. `classifyAndStore` reads the cover's titles from D1, builds the prompt, calls the model, and writes `ai_*` and `lr_*`.
7. **Read.** `/api/detector` applies the gate to model labels and returns what the card shows.

**Headline refresh.** The 10:00 and 13:00 UTC crons only refresh today's `headlines`, once capasjornais.pt shows the new edition. They fire no dispatch.

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
| Refit | `.github/workflows/refit-lr.yml`, monthly and on demand. Commits the weights; fails if the Python scorer disagrees with sklearn |
| Scores on past covers | `lr_*` backfilled out-of-fold by `scripts/backfill_lr_probabilities.py`; `lr_asof` is the fold's training cutoff |

**No gate score.** Consensus covers (no model answer to override), covers without a headline vector, and covers classified before their titles exist.

## Timing

Classification runs after the 05:00–08:00 scrapes. Today's titles usually arrive with the 10:00 refresh, when capasjornais.pt turns over. A cover classified before then gets:

- no titles block in the prompt;
- image-only retrieval;
- no gate score, so the gate never applies to it.

On 2026-09-15 all three covers were classified at 05:00 UTC; their headline vectors only appeared at 09:51.

## Dispatches

| Event | Fired by | Runs | Needs |
|---|---|---|---|
| `scrape-completed` | Worker cron, after each 05:00–08:00 scrape | `rag-classify.yml` | `GH_DISPATCH_TOKEN` |
| `cover-first-vote` | `handleSwipe`, on a cover's first crowd vote | `vectorize-covers.yml`, `vectorize-headlines.yml` | `GH_DISPATCH_TOKEN` |

`GH_DISPATCH_TOKEN` is a Worker secret: a classic PAT with `repo` scope. Without it dispatches are skipped and nothing is classified or embedded until a workflow is run by hand. `dispatchGithubEvent` never throws. Every workflow reads its whole backlog, so a missed dispatch is picked up by the next run.

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
