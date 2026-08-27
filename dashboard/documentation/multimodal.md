# Multimodal

Powers the dashboard's **AI Detector** card ("E a máquina, que diz?"): the second verdict card, same layout and arithmetic as "Hoje é dia de quem?", over the same three covers, except the club comes from a vision model reading the front page instead of from votes.

**Zero-shot.** The model is shown the cover and asked which club the page is about. Nothing is trained on this archive; crowd-labelled covers are used only as a benchmark.

## Model

`@cf/meta/llama-4-scout-17b-16e-instruct`, full-res image. Two things decided that:

- **Resolution.** Covers are called by the headline text, not kit colours: at 220px the Portuguese headline is unreadable. The classifier fetches the full-res original from R2 instead of the thumbnail the rest of the site uses.
- **Headline-first prompting.** The prompt asks for the headline before the answer, so the reply is prose parsed down to one of four keys. No `ANSWER:` line means no label; the parser never guesses.

The prompt also asks for a third line, `WHY: <the one detail that decided it>`, stored as `ai_why` and shown next to the model's call on the dashboard card.

> Agreement is agreement *with the crowd*, not correctness. Some disagreements are covers the model read right and the vote read wrong. Most covers carry a single vote, so the crowd side is thin too.

## Results

`scripts/eval-ai.mjs` scores the current prompt against the crowd labels, without deploying anything: public `/api/stats` for the labels, public R2 URLs for the images, a Workers AI · Read token for the calls.

```bash
CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… node scripts/eval-ai.mjs --n 80
```

Latest run, 80 covers evenly spaced across the archive:

| | |
|---|---|
| Agreement | **78.8%** (63/80) |
| benfica recall | 85% (23/27) |
| sporting recall | 91% (20/22) |
| porto recall | 82% (14/17) |
| others recall | 43% (6/14) |

`others` is the weak class: no consistent visual signature across four different kinds of front page (Seleção, Braga/Guimarães, another sport, a transfer round-up). Run this before *and* after any `PROMPT` change: the number moves, sometimes the wrong way. It also prints a confusion matrix and every miss with the headline the model quoted, which is what says whether a wrong call misread a rail box or hit a genuinely ambiguous page.

A prompt change only reaches covers that get classified again. `ai_headline`/`ai_why` missing still marks a cover as classified by an older prompt, but nothing automatically sweeps that marker anymore — there's no classification backfill mechanism (removed for simplicity, see [RAG](#rag)'s Quota section). A prompt change reaches old covers only if `scripts/rag_classify.py` happens to touch them (most recent N by date) or via a manual D1 query.

`node api/lib/ai.test.mjs` covers the parser, the part that turns a bad reply into a wrong label.

## Where it runs

Classification happens at the end of a successful scrape, after the D1 insert, so the cover is kept whether or not the model has an opinion about it. `classifyAndStore` swallows its own errors: a model hiccup must never take down the daily scrape. An unclassified cover (the model didn't answer) is simply absent from the AI section — nothing retries it automatically.

`/api/stats` returns a second `latestAi` block alongside `latest`. Papers the backfill hasn't reached yet are excluded from the day's verdict rather than counted as misses. If none of the latest day's covers are classified yet, `latestAi` is `null` and the section stays hidden. Expect this for the first hour or so after a fresh day's covers land.

## Where they disagree

Under the card, a button opens every cover the model and the crowd read differently. It navigates like the app's Histórico: a month picker, then that month's covers as portrait cards carrying both verdicts as colour blocks. No extra endpoint: `/api/stats` already returns `club` and `ai_club` per cover for the calendar, so it's a filter over rows already in memory.

## Cost

~$0.0006 per cover ($0.27/M input + $0.85/M output tokens). Three covers a day is roughly €0.65/year; classifying the entire archive is a one-off €0.75.

## For comparison: classic classifiers

`scripts/train_classic_classifier.py` runs the same crowd-voted covers through seven classic ML models (raw pixels, no OCR, no pretraining) as a deliberately old-school comparison. It has its own page: see [Classic Classifiers](#classic-classifiers).
