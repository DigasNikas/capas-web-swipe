# scripts/

This README only says where things are. The reasoning lives at [capas.digasnikas.com/documentation](https://capas.digasnikas.com/documentation).

Local tooling, not deployed. Most scripts have a matching one-click GitHub Action; a couple are deliberately local-only (see the table).

| Script | What | GitHub Action |
|---|---|---|
| `scrape_month.sh` | Trigger the `/scrape` API for a full calendar month, chunked into 7-day windows | Scrape Newspaper Covers (`mode: month`) |
| `eval-ai.mjs` | Score the AI prompt against the crowd labels, without deploying anything | — (local-only: Bot Fight Mode makes a runner unreliable for this, no gain over running it locally) |
| `avg_cover.py` | Pixel-wise mean of every cover → `dashboard/avg/` (numpy + pillow) | Regenerate A Capa Média |
| `import_matches.py` | Import match dates into D1 (football-data.org + api-sports.io) | Import Match Dates |
| `train_classic_classifier.py` | Classic-ML exercise: flatten covers to pixel vectors, fit 6 classic scikit-learn models + one from-scratch PyTorch MLP on the crowd's own labels, `--split chronological/stratified`, `--per-newspaper` and `--residual` toggles, report accuracy/precision/recall per model. Not a production model, no GitHub Action | — |
| `build_vectorize_index.py` | Embed crowd-labelled covers with CLIP (local, via transformers — no external API) and upsert into the `capas-cover-embeddings` Vectorize index (512 dims, cosine), metadata: club/newspaper/date/url. `--candidates` embeds the whole voted-but-unembedded backlog in one run; `--cover-id`/`--limit` stay for manual single-cover or full-archive runs. `rag_classify.py` reads this index | Vectorize Covers (automatic + manual) |
| `rag_classify.py` | Embed a cover, query Vectorize for similar labelled covers, fold their labels into the Llama4 prompt as few-shot context. Live mode writes to D1 via the Worker's admin API; `--eval` scores against crowd labels without touching the Worker | Classify Covers (automatic + manual) |
