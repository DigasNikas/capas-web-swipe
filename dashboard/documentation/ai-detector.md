# AI Detector

The dashboard's second verdict card. It repeats the layout and arithmetic of "Hoje é dia de quem?" over the same three covers, except the club comes from a vision model reading the front page instead of from votes.

**Zero-shot: nothing here is trained on this archive.** The model is shown the cover and asked which club the page is about. The 1255 crowd-labelled covers are used as a *benchmark*, never as training data.

## Model choice

Picked by benchmarking against 30 randomly sampled crowd-labelled covers. The sample was small and it flattered the winner: scored over the whole archive it lands at 77% (the next section).

| Model | Input | Agreement |
|---|---|---|
| **`@cf/meta/llama-4-scout-17b-16e-instruct`** | full-res | **87%** |
| `@cf/meta/llama-3.2-11b-vision-instruct` | full-res | 67% |
| `@cf/meta/llama-3.2-11b-vision-instruct` | 220px thumb | 53% |

Two things drive that gap, and both shaped the implementation:

- **Covers are decided by the headline text, not by kit colours.** At 220px the Portuguese headline is unreadable: that is the 67%→53% drop in the table above. So the classifier fetches the full-res original back out of R2 instead of reusing the thumbnail the rest of the site runs on.
- **Making the model quote the headline before answering is worth ~7 points.** The prompt asks for the headline first and an `ANSWER: <club>` line last, so the reply arrives as prose and is parsed back down to one of four keys. A reply with no `ANSWER:` line produces no label; the parser never guesses.

The prompt now asks for a third line between those two — `WHY: <the one detail that decided it>` — stored as `ai_why` and shown next to the model's call in the dashboard's AI card, so the justification isn't just the headline it read but the actual reason it named that club. Added after the benchmark below was run, so the agreement numbers on this page are from the two-line version; re-run `scripts/eval-ai.mjs` before trusting them against the current prompt.

> Agreement is *agreement with the crowd*, not correctness. Some disagreements ("rui costa seduz ríos") are covers the model read right and the vote read wrong. The number means "how often the machine and the room land in the same place", which is what the page claims. Most covers carry a single vote, so the crowd side is thin too.

## Scoring, and what the first prompt got wrong

30 covers was too small a benchmark. Scored across the whole archive that first prompt agreed on **77% (447/579)**, and the misses were lopsided:

| crowd label | recall | most common miss |
|---|---|---|
| sporting | 95% | — |
| porto | 92% | — |
| benfica | 76% | → sporting (22) |
| **others** | **39%** | → sporting (37), → porto (28) |

It over-called Sporting (+36% against the true count) and Porto (+33%), and under-called Benfica (−21%) and others (−51%). Three causes, all now fixed:

- **The parser guessed instead of abstaining.** With no `ANSWER:` marker in the reply (truncated output, a refusal, a paragraph of prose) it fell back to scanning the whole response, then picked whichever club came first in the `CLUBS` array rather than first in the text. "Not Benfica, this is Sporting" parsed as `benfica`. Now a reply without the marker produces no label: the cover keeps `ai_club IS NULL` and the next backfill pass retries it.
- **The prompt ignored the rails.** Every one of these front pages carries small `SPORTING` / `FC PORTO` section boxes down the side whatever the main story is. The prompt now names them and says to ignore them, along with teasers, adverts and results bars.
- **"Red kit" was a trap.** Record and A Bola print their own masthead in red, so red is the *least* discriminative colour on the page and a reliable way to lose Benfica covers. Colour cues are gone; the prompt lists names and nicknames (Águias, Leões, Dragões, Alvalade, da Luz) instead, and gives `others` an actual definition (Seleção, Braga, Guimarães, another sport, a transfer round-up) rather than leaving it as "none of the above".

`scripts/eval-ai.mjs` scores the current prompt against the crowd labels without deploying anything: public `/api/stats` for the labels, public R2 URLs for the images, a Workers AI · Read token for the calls. Run it before *and* after touching `PROMPT`, or trigger the **Evaluate AI Prompt** GitHub Action for a one-click run. See [Scraping](#scraping).

```bash
CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… node scripts/eval-ai.mjs --n 40
```

It prints agreement, per-class recall, a confusion matrix, and every miss with the headline the model quoted. That last column is what says whether it misread a rail box or hit a genuinely ambiguous page. Calls cost neurons against the same **10,000/day free allowance** the daily scrape uses, so budget `--all` (579 calls) accordingly.

A prompt change only reaches covers that get classified again, and `ai_headline` is what makes that automatic: covers labelled by an older prompt don't have one, so `/api/backfill-ai` picks them up on its normal loop and replaces the label in place. `ai_club` does not need wiping first, and the section keeps working while it runs.

`node api/lib/ai.test.mjs` covers the parser, the part that turns a bad reply into a wrong label.

## Where it runs

Classification happens at the end of a successful scrape, *after* the D1 insert, so the cover is kept whether or not the model has an opinion about it. `classifyAndStore` swallows its own errors for the same reason: a model hiccup must never take down the daily scrape. An unclassified cover is absent from the AI section until a backfill picks it up.

`/api/stats` returns a second `latestAi` block alongside `latest`. Papers the backfill hasn't reached yet are *excluded* from the day's verdict rather than counted as misses, so an in-progress backfill can't skew it. If none of the latest day's covers have been classified yet, `latestAi` is `null` and the whole section stays hidden until `/api/backfill-ai` catches up. Expect this for the first hour or so after a fresh day's covers land.

## Where they disagree

Under the card, a button opens every cover the model and the crowd read differently. It navigates like the app's Histórico: a month picker first, then that month's covers as portrait cards, each carrying both verdicts as colour blocks so the disagreement is legible at thumbnail size. No extra endpoint. `/api/stats` already returns `club` and `ai_club` per cover for the calendar, so it is a filter over rows already in memory, built on first open.

The section sits between the community verdict and the comments, so the conversation follows both readings.

## Cost

~$0.0006 per cover ($0.27/M input + $0.85/M output tokens). Three covers a day is roughly **€0.65/year**; classifying the entire archive is a **one-off €0.75**. The backfill exists to give the "concorda com a comunidade em X% das N capas" line a denominator worth quoting; the section itself only ever shows today.

## For comparison: classic classifiers

`scripts/train_classic_classifier.py` runs the same crowd-voted covers through seven classic ML models (raw pixels, no OCR, no pretraining) as a deliberately old-school comparison, plus follow-up experiments on top of that baseline. It has its own page — see [Classic Classifiers](#classic-classifiers).
