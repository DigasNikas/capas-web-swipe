# scripts/

This README is a map, not the manual — the reasoning lives at [capas.digasnikas.com/documentation](https://capas.digasnikas.com/documentation).

Local tooling, not deployed. Every script has a matching one-click GitHub Action too.

| Script | What | GitHub Action |
|---|---|---|
| `scrape_month.sh` | Trigger the `/scrape` API for a full calendar month, chunked into 7-day windows | Scrape Newspaper Covers (Full Month) |
| `eval-ai.mjs` | Score the AI prompt against the crowd labels, without deploying anything | Evaluate AI Prompt |
| `avg_cover.py` | Pixel-wise mean of every cover → `dashboard/avg/` (numpy + pillow) | Regenerate A Capa Média |
| `import_matches.py` | Import match dates into D1 (football-data.org + api-sports.io) | Import Match Dates |
| `train_classic_classifier.py` | Classic-ML exercise: flatten covers to pixel vectors, fit 6 classic scikit-learn models + one from-scratch PyTorch MLP on the crowd's own labels, report accuracy/precision/recall per model — not a production model, no GitHub Action | — |
