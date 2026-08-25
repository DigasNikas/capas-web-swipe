# AI Detector

The dashboard's second verdict card. Same three covers, same arithmetic, same layout as "Hoje é dia de quem?" — but the club comes from a vision model reading the front page instead of from votes.

**Zero-shot: nothing here is trained on this archive.** The model is shown the cover and asked which club the page is about. The 1255 crowd-labelled covers are used as a *benchmark*, never as training data.

## Model choice

Picked by benchmarking against 30 randomly sampled crowd-labelled covers. The sample was small and it flattered the winner — scored over the whole archive it lands at 77%, which is the next section:

| Model | Input | Agreement |
|---|---|---|
| **`@cf/meta/llama-4-scout-17b-16e-instruct`** | full-res | **87%** |
| `@cf/meta/llama-3.2-11b-vision-instruct` | full-res | 67% |
| `@cf/meta/llama-3.2-11b-vision-instruct` | 220px thumb | 53% |

Two things drive that gap, and both shaped the implementation:

- **Covers are decided by the headline text, not by kit colours.** So the classifier fetches the full-res original back out of R2 rather than reusing the 220px thumbnail the rest of the site runs on — at thumbnail resolution the Portuguese headline is unreadable and accuracy collapses.
- **Making the model quote the headline before answering is worth ~7 points.** The prompt asks for the headline first and an `ANSWER: <club>` line second, so the reply arrives as prose and is parsed back down to one of four keys — and a reply with no `ANSWER:` line in it is no label at all, not a guess.

> Agreement is *agreement with the crowd*, not correctness. Some of the disagreements — "rui costa seduz ríos" — are covers the model read right and the vote read wrong. Treat the number as "how often the machine and the room land in the same place", which is what the page actually claims. Most covers carry a single vote, so the crowd side of it is thin too.

## Scoring, and what the first prompt got wrong

30 covers was too small a benchmark. Scored across the whole archive that first prompt agreed on **77% (447/579)**, and the misses were lopsided:

| crowd label | recall | most common miss |
|---|---|---|
| sporting | 95% | — |
| porto | 92% | — |
| benfica | 76% | → sporting (22) |
| **others** | **39%** | → sporting (37), → porto (28) |

It over-called Sporting (+36% against the true count) and Porto (+33%), and under-called Benfica (−21%) and others (−51%). Three causes, all now fixed:

- **The parser guessed instead of abstaining.** With no `ANSWER:` marker in the reply — truncated output, a refusal, a paragraph of prose — it fell back to scanning the whole response, and then picked whichever club came first in the `CLUBS` array rather than first in the text. "Not Benfica, this is Sporting" parsed as `benfica`. Now a reply without the marker produces no label at all: the cover keeps `ai_club IS NULL` and the next backfill pass retries it.
- **The rails.** Every one of these front pages carries small `SPORTING` / `FC PORTO` section boxes down the side whatever the main story is, and the prompt never mentioned them. It now names them and says to ignore them, along with teasers, adverts and results bars.
- **"Red kit" was a trap.** Record and A Bola print their own masthead in red, so red is the *least* discriminative colour on the page — a good way to lose Benfica covers. Colour cues are gone; the prompt lists names and nicknames (Águias, Leões, Dragões, Alvalade, da Luz) instead, and gives `others` an actual definition (Seleção, Braga, Guimarães, another sport, a transfer round-up) rather than leaving it as "none of the above".

`scripts/eval-ai.mjs` scores the current prompt against the crowd labels without deploying anything: public `/api/stats` for the labels, public R2 URLs for the images, a Workers AI · Read token for the calls. Run it before *and* after touching `PROMPT`, and via the **Evaluate AI Prompt** GitHub Action for a one-click run instead — see [Scraping](#scraping).

```bash
CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… node scripts/eval-ai.mjs --n 40
```

It prints agreement, per-class recall, a confusion matrix, and every miss with the headline the model quoted — that last column is what says whether it misread a rail box or hit a genuinely ambiguous page. Calls cost neurons against the same **10,000/day free allowance** the daily scrape uses, so `--all` (579 calls) is not something to run twice in an afternoon.

A prompt change only reaches covers that get classified again, and `ai_headline` is what makes that automatic: covers labelled by an older prompt don't have one, so `/api/backfill-ai` picks them up on its normal loop and replaces the label in place. No wiping `ai_club` first — the section keeps working while it runs.

`node api/lib/ai.test.mjs` covers the parser, which is the part that turns a bad reply into a wrong label.

## Where it runs

Classification happens at the end of a successful scrape, *after* the D1 insert — the cover is worth keeping whether or not the model has an opinion about it. `classifyAndStore` swallows its own errors for the same reason: a model hiccup must never take down the daily scrape. An unclassified cover is simply absent from the AI section until a backfill picks it up.

`/api/stats` returns a second `latestAi` block alongside `latest`. Papers the backfill hasn't reached yet are *excluded* from the day's verdict rather than counted as misses, so an in-progress backfill can't skew it. If none of the latest day's covers have been classified yet, `latestAi` is `null` and the whole section stays hidden until `/api/backfill-ai` catches up — this is expected the first hour or so after a fresh day's covers land, not a bug.

## Where they disagree

Under the card, a button opens every cover the model and the crowd read differently. It navigates like the app's Histórico — a month picker first, then that month's covers as portrait cards, each carrying both verdicts as colour blocks so the disagreement is legible at thumbnail size. No extra endpoint: `/api/stats` already returns `club` and `ai_club` per cover for the calendar, so it is a filter over rows already in memory, built on first open.

The section sits between the community verdict and the comments — the conversation is about both readings, so it comes last.

## Cost

~$0.0006 per cover ($0.27/M input + $0.85/M output tokens). Three covers a day is roughly **€0.65/year**; classifying the entire archive is a **one-off €0.75**. The backfill exists to give the "concorda com a comunidade em X% das N capas" line a denominator worth quoting — the section itself only ever shows today.

## A classic-ML exercise, for comparison

`scripts/train_classic_classifier.py` is not part of this feature and doesn't touch D1 or `ai_club` — it's a separate, deliberately old-school exercise sitting next to it: no pretraining, no transfer learning, no OCR, the shape a first ML course teaches before reaching for anything smarter.

The pipeline is the whole point of how plain it is: fetch `(cover URL, crowd-voted club)` pairs from `/api/stats`, resize each cover to 32×32 and flatten it to a raw pixel vector — that's the entire feature-engineering step, no hand-built features — and fit `sklearn.linear_model.LogisticRegression` on the result. The split is chronological (train on the older 80%, test on the most recent 20%) rather than random, for the same reason `avg_cover.py`'s alignment matters: covers share a masthead template within a stretch of dates, so a random split would let near-duplicate examples leak between train and test and flatter the score.

```bash
python3 -m venv .venv && .venv/bin/pip install numpy pillow scikit-learn
.venv/bin/python scripts/train_classic_classifier.py
.venv/bin/python scripts/train_classic_classifier.py --limit 200   # quick run
```

It prints accuracy, per-class precision/recall/F1, and a confusion matrix — same shape as `eval-ai.mjs`'s own report, so the two are directly comparable. A 200-cover quick run landed at **75% accuracy**, which sounds close to the zero-shot model's 77% archive-wide — but the test slice at that sample size is only 40 covers (2 of them `others`), too small for the per-class numbers to mean much. The real comparison is a full run against the whole labelled archive, not this one.

Worth being honest about the ceiling here: the model choice section above found the signal is the headline *text*, and a model that can't read is working from strictly less information than one that can — so a lower plateau than the zero-shot model, once measured on the full archive, would be the expected outcome of skipping OCR entirely, not a bug in the exercise.
