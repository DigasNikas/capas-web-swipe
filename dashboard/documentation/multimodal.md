# Multimodal

Powers the dashboard's **AI Detector** card ("E a máquina, que diz?"): the second verdict card, same layout and arithmetic as "Hoje é dia de quem?", over the same three covers, except the club comes from a vision model reading the front page instead of from votes. This page documents the model and the prompt; [AI Detector](#ai-detector) covers where the call actually happens and [RAG](#rag) covers the context it's fed.

The model is shown the cover and asked which club the page is about, zero-shot, no training on this archive. `scripts/eval-ai.mjs` still runs it exactly that way, bare, as a benchmark. Live classification doesn't: every real call goes through `scripts/rag_classify.py` and gets a few-shot block from [RAG](#rag) prepended first, empty only when the archive has nothing similar yet. Same model, same prompt, same parser either way; RAG only adds a paragraph in front of it.

## Model

`@cf/meta/llama-4-scout-17b-16e-instruct`, full-res image. Two things decided that.

Covers are called by the headline text, not kit colours: at 220px the Portuguese headline is unreadable, so the classifier fetches the full-res original from R2 instead of the thumbnail the rest of the site uses. And the prompt asks for the headline before the answer, so the reply is prose parsed down to one of four keys, headline-first rather than answer-first. No `ANSWER:` line means no label; the parser never guesses.

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

A prompt change only reaches covers that get classified again. `ai_club`/`ai_headline`/`ai_why` are always written together by `classifyAndStore`, so `ai_club IS NULL` alone marks a cover as never classified, or reset (see [RAG](#rag)'s Quota section for `/rag-candidates`, which selects on exactly that and is self-converging across repeated runs). A prompt change on an already-classified archive still needs those three columns wiped by hand first, a manual D1 query; nothing detects "classified, but by an older prompt" automatically.

`node api/lib/ai.test.mjs` covers the parser, the part that turns a bad reply into a wrong label.

## Where it runs

Not in the scrape. `scrapeNewspaper` stores the cover and stops; `ai_club` stays `NULL` until `.github/workflows/rag-classify.yml` runs, which the Worker fires itself right after the day's scrape finishes (see [AI Detector](#ai-detector)). `classifyAndStore` swallows its own errors either way: a model hiccup must never take down that workflow run. An unclassified cover (the model didn't answer, or the workflow hasn't run yet) is simply absent from the AI section until the next run retries it.

`/api/stats` returns a second `latestAi` block alongside `latest`. Papers the backfill hasn't reached yet are excluded from the day's verdict rather than counted as misses. If none of the latest day's covers are classified yet, `latestAi` is `null` and the section stays hidden. Expect this for a while after a fresh day's covers land, until the automatic reclassify run catches up.

## Where they disagree

Under the card, a button opens every cover the model and the crowd read differently. It navigates like the app's Histórico: a month picker, then that month's covers as portrait cards carrying both verdicts as colour blocks. No extra endpoint: `/api/stats` already returns `club` and `ai_club` per cover for the calendar, so it's a filter over rows already in memory.

Opening one of those covers can also show the covers RAG actually used, when there are any: `/api/stats` returns `ai_rag_covers` alongside the rest, and the modal resolves those ids against the same rows already in memory (they're the same crowd-voted covers the calendar itself needs) rather than a second request. Covers classified before `ai_rag_covers` existed have nothing to resolve, so the button is simply absent for most of the archive. See [RAG](#rag) for what the column holds and why.

## Cost

~$0.0006 per cover ($0.27/M input + $0.85/M output tokens). Three covers a day is roughly €0.65/year; classifying the entire archive is a one-off €0.75.

## For comparison: classic classifiers

`scripts/train_classic_classifier.py` runs the same crowd-voted covers through seven classic ML models (raw pixels, no OCR, no pretraining) as a deliberately old-school comparison. It has its own page: see [Classic Classifiers](#classic-classifiers).
