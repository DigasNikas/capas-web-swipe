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

The pipeline is the whole point of how plain it is: fetch `(cover URL, crowd-voted club)` pairs from `/api/stats`, resize each cover to 32×32 and flatten it to a raw pixel vector — that's the entire feature-engineering step, no hand-built features. The split is chronological (train on the older 80%, test on the most recent 20%) rather than random, for the same reason `avg_cover.py`'s alignment matters: covers share a masthead template within a stretch of dates, so a random split would let near-duplicate examples leak between train and test and flatter the score.

That same vector feeds seven different models, one per family, so the comparison is about the algorithm rather than the input: logistic regression (linear), k-nearest neighbours (distance), a decision tree and a random forest (tree-based), a linear SVM (margin), naive Bayes (probabilistic), and — the one actual tensor-based model here — a small two-layer feedforward net trained from scratch with PyTorch (`torch.Tensor`, Adam, cross-entropy). "From scratch" still holds for that one too: no pretrained weights, just backprop on the same pixel vectors every other model gets. `torch` is optional — the script skips that last model with a note if it isn't installed, rather than making a ~600 MB dependency mandatory for the other six.

```bash
python3 -m venv .venv && .venv/bin/pip install numpy pillow scikit-learn
.venv/bin/pip install torch          # optional — adds the PyTorch MLP
.venv/bin/python scripts/train_classic_classifier.py
.venv/bin/python scripts/train_classic_classifier.py --limit 200   # quick run
```

Each model gets the same report — accuracy, per-class precision/recall/F1, confusion matrix, same shape as `eval-ai.mjs`'s own output — followed by a summary table ranked by accuracy.

### Data

| | |
|---|---|
| Examples | **1,555** covers — every one with a crowd vote in `analytics_covers` (the archive holds more; unvoted covers aren't labelled, so they're excluded here) |
| Representation | Each cover resized to 32×32 and flattened to a raw RGB pixel vector — **3,072 features**, values normalized to `[0, 1]`. No crops, no colour histograms, no OCR, no hand-built features of any kind |
| Split | `--split chronological` (default) or `--split stratified` — see below for both. Either way, 80/20, **1,244 train** / **311 test** |
| Labels | 4 classes from `analytics_covers.club`: `benfica`, `sporting`, `porto`, `others` |
| Majority-class baseline | Always guessing `benfica` (the largest class in the test split) scores **35.7%** (111/311) |

### Results — chronological split

| Model | Accuracy | Macro F1 |
|---|---|---|
| Random Forest | **62.1%** | 0.52 |
| Small MLP (PyTorch, from scratch) | **62.1%** | 0.52 |
| Naive Bayes | 60.8% | 0.57 |
| k-Nearest Neighbours | 56.9% | 0.52 |
| Logistic Regression | 55.3% | 0.50 |
| Linear SVM | 54.3% | 0.49 |
| Decision Tree | 43.7% | 0.43 |

Every model clears the 35.7% baseline, so all seven are learning *something* from raw pixels alone — just not much beyond "which club's mean colour palette does this look closest to." All seven land well below the zero-shot model's 77% archive-wide agreement, which is the expected cost of skipping OCR entirely: the model choice section above already established the signal is the headline *text*, and none of these seven models can read.

**Recall per class** — the more telling table, since accuracy alone hides which class each model is actually failing on:

| Model | sporting | benfica | porto | others |
|---|---|---|---|---|
| Naive Bayes | 64% | 78% | 61% | **26%** |
| Logistic Regression | 68% | 77% | 41% | 17% |
| Linear SVM | 68% | 76% | 36% | 18% |
| k-Nearest Neighbours | 45% | 84% | 64% | 18% |
| Decision Tree | 55% | 45% | 49% | 23% |
| Random Forest | 67% | 88% | 73% | 2% |
| Small MLP (PyTorch) | 70% | 93% | 63% | **0%** |

`others` collapses for every model — worst for the two that scored *highest* on accuracy (Random Forest 2%, the MLP 0%, both just learning to guess `benfica` whenever unsure, since it's the largest class). This is the exact same failure shape the zero-shot model's first prompt had (see "Scoring, and what the first prompt got wrong" above: 39% recall on `others`, over-calling Sporting and Porto) — except there the fix was rewording the prompt to give `others` an actual definition. There's no prompt to reword here: `others` genuinely has no consistent visual signature across four completely different kinds of front page (Seleção, Braga/Guimarães, another sport, a transfer round-up), so a model with no way to read what the headline says has nothing else to grab onto for that class. Confirms, from a completely different angle, that the earlier zero-shot fix was solving a real problem rather than an artifact of one bad prompt.

### Results — stratified split

Same 1,555 covers, same 80/20 ratio, same seven models — the only thing that changes is `train_test_split(..., stratify=y, random_state=0)` instead of the date cutoff, so the test set's four classes land in their true archive proportions (sporting 83, benfica 107, porto 64, others 57 — majority-class baseline **34.4%**) instead of whatever the most recent 311 covers happened to be.

| Model | Accuracy | Macro F1 |
|---|---|---|
| Random Forest | **62.1%** | 0.54 |
| Naive Bayes | 61.4% | 0.58 |
| Logistic Regression | 61.1% | 0.58 |
| Small MLP (PyTorch, from scratch) | 58.2% | 0.46 |
| Linear SVM | 56.3% | 0.54 |
| k-Nearest Neighbours | 55.3% | 0.50 |
| Decision Tree | 38.6% | 0.36 |

**Recall per class:**

| Model | sporting | benfica | porto | others |
|---|---|---|---|---|
| Logistic Regression | 69% | 71% | 64% | 28% |
| k-Nearest Neighbours | 41% | 83% | 62% | 16% |
| Decision Tree | 35% | 50% | 45% | 16% |
| Random Forest | 60% | 82% | 80% | 7% |
| Linear SVM | 65% | 66% | 53% | 28% |
| Naive Bayes | 67% | 65% | 80% | 25% |
| Small MLP (PyTorch) | 67% | 95% | 36% | 0% |

Random Forest scores byte-for-byte the same accuracy under both splits (62.1%) — reassuring, since it means that number isn't an artifact of which 311 covers ended up in the test set. Logistic Regression and Naive Bayes both do noticeably better stratified (55.3%→61.1%, 60.8%→61.4%): some of what looked like a weakness in the chronological run was really the chronological test tail being a harder-than-average slice of the archive for a linear/probabilistic model. The MLP goes the other way (62.1%→58.2%), which given it's the one model here with enough capacity to overfit is a small flag for that specific run rather than a strength lost.

The one number that *doesn't* move is the one that matters most: `others` recall stays near-zero for Random Forest (2%→7%) and the MLP (0%→0%) regardless of split strategy. If the chronological result had been an artifact of test-set imbalance, stratifying would have fixed it — it didn't, which is stronger evidence that these two models specifically default to `benfica` (the largest class) whenever unsure, independent of how the test set happens to be composed. Logistic Regression, Linear SVM and Naive Bayes all keep `others` recall in the 25–28% range under stratification too, versus these two collapsing toward 0% — the margin models and linear model spread their mistakes across classes instead of defaulting to the majority one.

### Results — per newspaper

The archive only ever has three newspapers in it — A Bola, Record, O Jogo — and each is itself a fixed template: same layout, same fonts, same colour scheme on every issue. Pooling all three for training means a model can shortcut on "which paper is this" instead of "what does this cover say", since paper and club aren't independent (O Jogo, for one, runs Porto far more often than the other two). `--per-newspaper` removes that shortcut entirely: it trains and tests seven fresh models per paper, using only that paper's own covers, so a model can only possibly be reading the photo and headline, never the masthead.

| Newspaper | Covers | Train | Test | Test-set split (sporting/benfica/porto/others) | Majority baseline |
|---|---|---|---|---|---|
| A Bola | 525 | 420 | 105 | 28 / 50 / 4 / 23 | 47.6% (benfica) |
| O Jogo | 509 | 407 | 102 | 5 / 11 / 58 / 28 | 56.9% (porto) |
| Record | 521 | 416 | 105 | 40 / 49 / 2 / 14 | 46.7% (benfica) |

**Accuracy by model × newspaper:**

| Model | A Bola | O Jogo | Record |
|---|---|---|---|
| Logistic Regression | 69.5% | 54.9% | **82.9%** |
| Small MLP (PyTorch) | 68.6% | **57.8%** | 81.9% |
| Linear SVM | 64.8% | 50.0% | 79.0% |
| Naive Bayes | 61.9% | 51.0% | 78.1% |
| Random Forest | 61.0% | 55.9% | 78.1% |
| k-Nearest Neighbours | 56.2% | 53.9% | 62.9% |
| Decision Tree | 43.8% | 47.1% | 58.1% |

Splitting by newspaper is not free — every paper's training set shrinks from 1,244 pooled covers down to ~410–420 — but two of the three still come out ahead of the pooled chronological run (best pooled: 62.1%). Record jumps to **82.9%**, a +20.8pp gain, and A Bola to 69.5%, +7.4pp; O Jogo's best model (57.8%) actually lands *below* the pooled number, and barely above its own 56.9% majority-class baseline — for O Jogo specifically, none of these seven pixel-only models find much real signal, isolated or not (its test set isn't the pooled one, so this isn't a strict like-for-like comparison, but the standalone number stands on its own regardless).

That gap also reframes the `others`-recall collapse from the two split-strategy runs above. Looked at per newspaper, Random Forest and the MLP get **exactly 0% recall on whichever class is numerically smallest in that paper's own test set** — porto in A Bola (4 covers) and Record (2 covers), sporting in O Jogo (5 covers) — regardless of what that class is actually called. So it was never really `others` these two models struggle with; it's whichever label is rarest in front of them. High-capacity, high-accuracy models here default to the safe majority guess the moment a class gets thin, which the pooled runs happened to always make `others` (the pooled archive's own rarest label) — same underlying mechanism, a coincidence of which label that turned out to be.


