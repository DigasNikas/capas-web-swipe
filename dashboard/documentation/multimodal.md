# Multimodal

The vision model behind the **AI Detector** card ("E a máquina, que diz?"). It reads each cover and names the club the page is about. [AI Detector](#ai-detector) covers the pipeline around the call, [RAG](#rag) the context fed into it.

| | |
|---|---|
| Model | `@cf/meta/llama-4-scout-17b-16e-instruct` (Workers AI) |
| Input | Full-resolution cover from R2, after the few-shot block and the page's scraped titles (see [AI Detector](#ai-detector)) |
| Settings | `temperature: 0.2`, `max_tokens: 300` |
| Reply | Four lines: `OWNS`, `HEADLINE`, `WHY`, `ANSWER` |
| Stored | `ai_club`, `ai_owns`, `ai_headline`, `ai_why`, `ai_source = 'model'` |
| Code | `api/lib/ai.js`: `PROMPT`, `parseAnswer`, `classifyAndStore` |

## Model choice

30 randomly sampled crowd-labelled covers, same prompt:

| Model | Image | Agreement |
|---|---|---|
| **Llama 4 Scout 17B** | full resolution | **87%** |
| Llama 3.2 11B Vision | full resolution | 67% |
| Llama 3.2 11B Vision | 220px thumbnail | 53% |

Covers are called by their Portuguese text, which is unreadable at thumbnail size. The classifier always fetches the original from R2.

## Prompt

`PROMPT` tells the model to:

1. Find the largest photo on the page, name its club, and read only that photo's headline.
2. Treat a page shared by two clubs, neither clearly bigger, as `others`.
3. Ignore the masthead and its colour, the SPORTING / FC PORTO / BENFICA side rails, teasers, adverts, results bars, and small headline strips.
4. Map names and nicknames to clubs (Águias → benfica, Leões → sporting, Dragões → porto). `others` covers the national team, other clubs, other sports, and transfer round-ups with no single club on top.
5. Decide whether one club owns the page before naming it.

## Reply and parser

| Line | Column | Content |
|---|---|---|
| `OWNS: yes\|no` | `ai_owns` | Whether one club owns the page |
| `HEADLINE:` | `ai_headline` | The largest photo's headline, copied |
| `WHY:` | `ai_why` | The detail that decided it |
| `ANSWER:` | `ai_club` | `benfica`, `sporting`, `porto` or `others` |

`parseAnswer` is strict. No `ANSWER:` line means no label, and the cover is retried on the next run. The label always comes from `ANSWER:`, even when `OWNS: no` contradicts it. `node api/lib/ai.test.mjs` covers the parser.

## Prompt experiments

| Change | Sample | Effect | Status |
|---|---|---|---|
| Ownership rule in prose only | fixed sample | `others` recall barely moved | Replaced by `OWNS` |
| `OWNS:` asked before the answer | 21 covers | `others` recall 2/9 → 5/9; club classes 12/12 → 12/12 | Kept |
| `PHOTOS:` line listing every club with a large photo | 30 covers | `others` recall 9/11, agreement 72% → 63% | Reverted |

## Results

Live data, covers from 2026-06-13 to 2026-09-15, against crowd labels.

**Model calls (117 covers).** "Shown" is the label the card displays after the `others` gate at threshold 0.65 (see [AI Detector](#ai-detector)).

| Crowd label | Covers | Model | Shown |
|---|---|---|---|
| benfica | 32 | 29 (91%) | 28 (88%) |
| sporting | 28 | 26 (93%) | 25 (89%) |
| porto | 28 | 27 (96%) | 26 (93%) |
| others | 29 | 12 (41%) | 25 (86%) |
| **Total** | **117** | **94 (80.3%)** | **104 (88.9%)** |

**All classified covers (239).** 122 were labelled by the consensus path with no model call, 120 of them (98.4%) matching the crowd. Overall shown agreement: **93.7%**.

**`OWNS`.** When the model named a club, `OWNS` was `yes` on 102 of 102 covers. When it answered `others`, `OWNS` was `yes` on 7 and `no` on 8.

**First prompt, for reference.** 77% agreement (447/579), `others` recall 39%.

> Agreement is with the crowd, not with ground truth. Most covers carry one vote.

## Evaluating a prompt change

`scripts/eval-ai.mjs` runs the current `PROMPT` against crowd labels without deploying. It uses public `/api/stats` and R2 URLs, plus a **Workers AI · Read** token. It sends the image and `PROMPT` only, without the few-shot block or the scraped titles, so its numbers aren't comparable with live results.

```bash
CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… node scripts/eval-ai.mjs --n 80   # evenly spaced sample
... node scripts/eval-ai.mjs --all                                               # every labelled cover
```

It prints agreement, recall per class, a confusion matrix, and every miss with the headline the model quoted. Run it before and after any `PROMPT` change.

A prompt change only reaches covers classified again. `/rag-candidates` selects `ai_club IS NULL`, so re-classifying the archive means clearing the `ai_*` columns by hand first.

## Where it runs

In `.github/workflows/rag-classify.yml`, which the Worker dispatches after each day's scrape. Not in the scrape itself. `classifyAndStore` never throws: a failed call leaves `ai_club` `NULL` and the cover is retried on the next run.

`/api/detector` serves the results: every classified cover, the label to show, the model's own answer, the crowd's label, and the latest day's verdict. Covers not yet classified are left out of the day's verdict. If none of the day's covers are classified, `latest` is `null` and the card stays hidden.

## Where they disagree

A button under the card opens every cover where the shown label and the crowd differ. A month picker, then that month's covers with both labels as colour blocks. Built from the `/api/detector` response already loaded, no extra request.

## Cost

| | |
|---|---|
| Per model call | ~65 neurons (measured) |
| Free allowance | 10,000 neurons/day, ~150 model calls |
| Beyond it | $0.011 per 1,000 neurons (Workers Paid) |
| Daily run | 3 covers, ~195 neurons: inside the free allowance |
| Consensus covers | 0 neurons |
| Whole archive, 1,869 covers | ~121,000 neurons: ~12 days of free allowance, or ~$1.33 |

## For comparison

[Classic Classifiers](#classic-classifiers) runs seven classic models on the same crowd labels, over raw pixels and over the stored embeddings.
