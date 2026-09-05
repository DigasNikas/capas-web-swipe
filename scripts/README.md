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
| `build_headline_index.py` | Embed each crowd-labelled cover's lead headline with multilingual-e5-base (local, via transformers) and upsert into the `capas-headline-embeddings` Vectorize index (768 dims, cosine), metadata: club/newspaper/date. Self-converging through `/vectorize-candidates?index=headline` and `/vectorize-mark {index: "headline"}`. `rag_classify.py` reads this index | Vectorize Headlines (automatic + manual) |
| `headline_embeddings.py` | Shared by the two above: which part of `covers.headlines` gets embedded (the lead story) and the model that embeds it. Not run directly | — |
| `rag_classify.py` | Embed a cover twice — image against `capas-cover-embeddings`, lead headline against `capas-headline-embeddings` — merge the two result sets, and either fold their labels into the Llama4 prompt as few-shot context or, when enough of them agree, skip the model and write that label directly. Live mode writes to D1 via the Worker's admin API; `--eval` scores against crowd labels without touching the Worker (pulling the scraped headline text it needs for prompt parity from `/headlines`) | Classify Covers (automatic + manual) |
| `backfill_headlines_archive.mjs` | Fills `headlines` for covers scraped before that column existed, by crawling capasjornais.pt's monthly archive pages (date → dated permalink) and reading each permalink's headline block — the live scraper's own headline fetch only works for the day it runs on. `--limit`/`--delay` for a smaller/politer run | — (local-only for now) |
