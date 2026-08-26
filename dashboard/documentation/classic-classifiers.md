# Classic Classifiers

`scripts/train_classic_classifier.py` is not part of the AI Detector feature and doesn't touch D1 or `ai_club`. It is a separate, deliberately old-school exercise sitting next to it: no pretraining, no transfer learning, no OCR, the shape a first ML course teaches before reaching for anything smarter. Not meant to compete with the zero-shot model (see [AI Detector](#ai-detector)) or its archive-wide agreement — the point here is the exercise itself, and what each attempt to improve it reveals.

Each experiment below is a different answer to "what does the model actually see," run through the same seven classifiers (logistic regression, k-nearest neighbours, a decision tree, a random forest, a linear SVM, naive Bayes, and an optional small from-scratch PyTorch MLP) so the comparison stays about the input, not the algorithm.

```bash
python3 -m venv .venv && .venv/bin/pip install numpy pillow scikit-learn
.venv/bin/pip install torch          # optional — adds the PyTorch MLP
.venv/bin/python scripts/train_classic_classifier.py
.venv/bin/python scripts/train_classic_classifier.py --limit 200   # quick run
.venv/bin/python scripts/train_classic_classifier.py --per-newspaper
.venv/bin/python scripts/train_classic_classifier.py --residual
.venv/bin/python scripts/train_classic_classifier.py --residual --per-newspaper
```

Each model gets the same report (accuracy, per-class precision/recall/F1, confusion matrix, the same shape as `eval-ai.mjs`'s own output) followed by a summary table ranked by accuracy.

## Experiment 1 — Raw pixels

The pipeline is as plain as it gets: fetch `(cover URL, crowd-voted club)` pairs from `/api/stats`, resize each cover to 32×32 and flatten it to a raw pixel vector. That is the entire feature-engineering step. The split is chronological (train on the older 80%, test on the most recent 20%) rather than random, for the same reason `avg_cover.py`'s alignment matters: covers share a masthead template within a stretch of dates, so a random split would let near-duplicate examples leak between train and test and flatter the score.

### Data

| | |
|---|---|
| Examples | **1,555** covers, every one with a crowd vote in `analytics_covers`. The archive holds more; unvoted covers aren't labelled, so they're excluded here |
| Representation | Each cover resized to 32×32 and flattened to a raw RGB pixel vector: **3,072 features**, values normalized to `[0, 1]`. No crops, no colour histograms, no OCR, no hand-built features of any kind |
| Split | `--split chronological` (default) or `--split stratified`, both reported below. Either way, 80/20, **1,244 train** / **311 test** |
| Labels | 4 classes from `analytics_covers.club`: `benfica`, `sporting`, `porto`, `others` |
| Majority-class baseline | Always guessing `benfica` (the largest class in the test split) scores **35.7%** (111/311) |

### Results: chronological split

| Model | Accuracy | Macro F1 |
|---|---|---|
| Random Forest | **62.1%** | 0.52 |
| Small MLP (PyTorch, from scratch) | **62.1%** | 0.52 |
| Naive Bayes | 60.8% | 0.57 |
| k-Nearest Neighbours | 56.9% | 0.52 |
| Logistic Regression | 55.3% | 0.50 |
| Linear SVM | 54.3% | 0.49 |
| Decision Tree | 43.7% | 0.43 |

Every model clears the 35.7% baseline, so all seven learn *something* from raw pixels alone, roughly "which club's mean colour palette does this look closest to." All seven land well below the zero-shot model's archive-wide agreement, the expected cost of skipping OCR: the model choice section of [AI Detector](#ai-detector) established that the signal is the headline *text*, and none of these seven can read.

**Recall per class**, since accuracy alone hides which class each model is failing on:

| Model | sporting | benfica | porto | others |
|---|---|---|---|---|
| Naive Bayes | 64% | 78% | 61% | **26%** |
| Logistic Regression | 68% | 77% | 41% | 17% |
| Linear SVM | 68% | 76% | 36% | 18% |
| k-Nearest Neighbours | 45% | 84% | 64% | 18% |
| Decision Tree | 55% | 45% | 49% | 23% |
| Random Forest | 67% | 88% | 73% | 2% |
| Small MLP (PyTorch) | 70% | 93% | 63% | **0%** |

`others` collapses for every model, worst for the two that scored *highest* on accuracy (Random Forest 2%, the MLP 0%, both learning to guess `benfica` whenever unsure, since it's the largest class). This is the same failure shape the zero-shot model's first prompt had (see "Scoring, and what the first prompt got wrong" in [AI Detector](#ai-detector): 39% recall on `others`, over-calling Sporting and Porto). There the fix was rewording the prompt to give `others` an actual definition. There's no prompt to reword here: `others` has no consistent visual signature across four different kinds of front page (Seleção, Braga/Guimarães, another sport, a transfer round-up), so a model that can't read the headline has nothing to grab onto for that class. From a different angle, that confirms the earlier zero-shot fix was solving a real problem rather than an artifact of one bad prompt.

### Results: stratified split

Same 1,555 covers, same 80/20 ratio, same seven models. The only change is `train_test_split(..., stratify=y, random_state=0)` instead of the date cutoff, so the test set's four classes land in their true archive proportions (sporting 83, benfica 107, porto 64, others 57; majority-class baseline **34.4%**) instead of whatever the most recent 311 covers happened to be.

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

Random Forest scores the same accuracy under both splits (62.1%), so that number isn't an artifact of which 311 covers ended up in the test set. Logistic Regression and Naive Bayes both do better stratified (55.3%→61.1%, 60.8%→61.4%): some of what looked like a weakness in the chronological run was the chronological test tail being a harder-than-average slice for a linear or probabilistic model. The MLP goes the other way (62.1%→58.2%); it is the one model here with enough capacity to overfit, so read that as a flag on that specific run.

The number that *doesn't* move is the one that matters most. `others` recall stays near zero for Random Forest (2%→7%) and the MLP (0%→0%) under either split strategy. If the chronological result had been an artifact of test-set imbalance, stratifying would have fixed it. It didn't, which is stronger evidence that these two models default to `benfica` (the largest class) whenever unsure, independent of how the test set is composed. Logistic Regression, Linear SVM and Naive Bayes keep `others` recall in the 25–28% range under stratification, spreading their mistakes across classes instead of defaulting to the majority one.

### Results: per newspaper

The archive only ever has three newspapers in it (A Bola, Record, O Jogo) and each is a fixed template, identical layout and fonts and colours on every issue. Pooling all three for training lets a model shortcut on "which paper is this" instead of "what does this cover say", since paper and club aren't independent: O Jogo runs Porto far more often than the other two. `--per-newspaper` removes that shortcut. It trains and tests seven fresh models per paper, using only that paper's own covers, so a model can only be reading the photo and headline, never the masthead.

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

Splitting by newspaper costs training data: every paper's set shrinks from 1,244 pooled covers to ~410–420. Two of the three still come out ahead of the pooled chronological run (best pooled: 62.1%). Record jumps to **82.9%**, a +20.8pp gain, and A Bola to 69.5%, +7.4pp. O Jogo's best model (57.8%) lands *below* the pooled number and barely above its own 56.9% majority-class baseline, so for O Jogo none of these seven pixel-only models find much real signal, isolated or not. Its test set isn't the pooled one, so this isn't a strict like-for-like comparison, but the standalone number stands on its own.

That gap also reframes the `others`-recall collapse from the two split-strategy runs above. Per newspaper, Random Forest and the MLP collapse toward **0% recall on each paper's two least-represented classes**: porto and others in A Bola, sporting and benfica in O Jogo, porto and others in Record, whatever those classes are called. The problem was never `others` specifically, it is whichever labels are rarest in front of them. High-capacity, high-accuracy models here default to the safe majority guess the moment a class gets thin, and in the pooled runs the thin class always happened to be `others`, the pooled archive's own rarest label.

### Per newspaper, stratified split

Same per-newspaper isolation, `--split stratified` instead of the date cutoff. Same check as the pooled comparison above, now run inside each paper's own, much smaller dataset.

| Newspaper | Test-set split (sporting/benfica/porto/others) | Majority baseline |
|---|---|---|
| A Bola | 31 / 48 / 5 / 21 | 45.7% (benfica) |
| O Jogo | 8 / 16 / 55 / 23 | 53.9% (porto) |
| Record | 44 / 44 / 4 / 13 | 41.9% (sporting/benfica tied) |

| Model | A Bola | O Jogo | Record |
|---|---|---|---|
| Logistic Regression | **70.5%** | **60.8%** | 76.2% |
| k-Nearest Neighbours | 61.0% | 45.1% | 61.9% |
| Decision Tree | 47.6% | 43.1% | 46.7% |
| Random Forest | 68.6% | 53.9% | 72.4% |
| Linear SVM | 63.8% | 58.8% | 71.4% |
| Naive Bayes | 61.0% | 47.1% | 65.7% |
| Small MLP (PyTorch) | 67.6% | 54.9% | **78.1%** |

Same shape as the chronological per-newspaper run. A Bola (70.5% vs 69.5%) and Record (78.1% vs 82.9%) land in the same range either way, so neither result was a fluke of the date cutoff. O Jogo is the one that moves: its best model now clears its own baseline by +6.9pp (53.9%→60.8%) instead of the chronological run's +0.9pp. O Jogo isn't signal-free after all; its most recent covers just happened to be an unusually hard stretch for these models.

The two-smallest-classes collapse replicates too. Random Forest and the MLP again land at 0% recall on each paper's rarest pair: porto and others in A Bola, sporting and benfica in O Jogo (bar the MLP's 6% on benfica, one correct guess out of 16), porto and others in Record. Two split strategies, six newspaper-scoped training runs, the same models defaulting to the majority class every time a label gets thin.

## Experiment 2 — Avg-cover residual

The dashboard's "a capa média" feature (`avg_cover.py`) averages every cover per newspaper: the masthead survives sharp because it's identical every day, headlines and photos blur into a ghost because they move around. The hypothesis: subtract that average before flattening, and the classifier's fixed 3,072-feature budget stops being spent on the part of the page that never changes.

`--residual` doesn't reuse `dashboard/avg/{newspaper}.jpg` directly. Those images are built in a different, *aligned* coordinate frame — `avg_cover.py` cross-correlates each cover's row-brightness profile against a reference and shifts it before stacking, because the archive spans two scrapes and the masthead sits roughly 70px apart between them. Subtracting that aligned average from an individual cover here, which is never shifted, would misregister by however far that specific cover's own offset is — worse than no subtraction for exactly the covers that need the biggest shift. Instead, `--residual` recomputes each newspaper's mean fresh, in this script's own unaligned 32×32 space, **from the training rows only** — the test rows never contribute to the average that gets subtracted from them.

### Results: chronological split, pooled

Same 1,564 covers (the archive grew by a handful since Experiment 1 ran), same split, same six sklearn models, `--residual` against the unmodified baseline.

| Model | Raw pixels | Residual | Δ |
|---|---|---|---|
| Random Forest | 62.3% | 60.7% | −1.6pp |
| Naive Bayes | 61.0% | 58.8% | −2.2pp |
| k-Nearest Neighbours | 57.5% | 47.0% | **−10.5pp** |
| Logistic Regression | 56.9% | 49.8% | −7.1pp |
| Linear SVM | 54.3% | 49.2% | −5.1pp |
| Decision Tree | 45.0% | 41.5% | −3.5pp |

Every model got worse. Not marginally — k-Nearest Neighbours lost over ten points, and it's the model most directly sensitive to this: subtracting a mean doesn't change *distances between* points as long as the same mean is subtracted from everything, so a real accuracy drop this size points at something systematic, not noise.

The likely cause is the same masthead-position drift the two-paragraph explanation above exists to warn about, just showing up from the other direction. Each cover here is still resized to 32×32 independently, with no cross-cover alignment — exactly like Experiment 1. The newspaper's own mean is therefore a *blurry, slightly misregistered* template (covers from the two scrape eras don't stack on exactly the same pixel rows), and subtracting a misaligned blur from a sharp individual image doesn't cancel a fixed masthead so much as print a faint ghost edge of it into every vector — structured noise at exactly the boundaries (masthead edge, box borders) that used to be a stable, exploitable signal for "which paper is this," which several of these models were apparently leaning on more than expected. `others` recall barely moved (e.g. Naive Bayes 26%→26%) while the other three classes all got worse — consistent with paper-identity signal being damaged rather than headline signal being clarified.

**Verdict:** subtracting a naive, unaligned average doesn't help and measurably hurts. Worth trying with `avg_cover.py`'s own alignment logic ported into this script — so the subtracted template and the cover being classified are in the same registered frame — before concluding the residual idea itself is dead; this experiment only rules out the unaligned version of it.

### Results: per newspaper

`--per-newspaper --residual` — same isolation as Experiment 1's per-newspaper run (each paper trains and tests on only its own covers), now with the training-set mean subtracted.

| Newspaper | Train | Test |
|---|---|---|
| A Bola | 422 | 106 |
| O Jogo | 409 | 103 |
| Record | 419 | 105 |

| Model | A Bola raw → residual | O Jogo raw → residual | Record raw → residual |
|---|---|---|---|
| Logistic Regression | 68.9% → 67.9% | 55.3% → 55.3% | 83.8% → 84.8% |
| k-Nearest Neighbours | 55.7% → 55.7% | 54.4% → 54.4% | 63.8% → 63.8% |
| Decision Tree | 39.6% → 39.6% | 45.6% → 45.6% | 56.2% → 56.2% |
| Random Forest | 61.3% → 61.3% | 58.3% → 58.3% | 75.2% → 75.2% |
| Linear SVM | 65.1% → 65.1% | 51.5% → 50.5% | 80.0% → 80.0% |
| Naive Bayes | 61.3% → 61.3% | 50.5% → 50.5% | 78.1% → 78.1% |

Four of six models are **bit-for-bit identical**, and the other two move by ≤1pp. That's not the residual failing to matter — it's the residual being mathematically unable to matter here, for a reason worth understanding rather than a coincidence:

- **k-Nearest Neighbours, Decision Tree, Random Forest, Naive Bayes are all invariant to a uniform shift.** Subtracting a constant vector from every row (train and test alike) doesn't change the *distance* between any two rows, so k-NN's predictions can't change. Tree splits are threshold comparisons on individual features; shifting a feature by a constant just shifts the optimal threshold by the same constant, giving an identical tree. GaussianNB compares `x` against each class's fitted mean `μ_c`; subtract the same constant from `x` and from every `μ_c` and `x − μ_c` is unchanged. None of these four ever had a chance of moving, in exact arithmetic.
- **Logistic Regression and Linear SVM aren't exactly invariant** — L2 regularization penalizes the weight vector, and an iterative solver (`liblinear`; the "failed to converge" warning shows up in this script's own output) can land in a slightly different place depending on where it starts. That's the entire ±1pp.

This is the piece that actually explains the pooled result above, not just a second data point. Pooling subtracts a *different* mean from each newspaper's rows before combining them into one training set — not a single uniform shift, but three different ones layered into the same space. That changes the distance between an A Bola row and an O Jogo row, which is exactly the "which paper is this" signal several models leaned on, and exactly the mechanism the pooled section attributes the accuracy drop to. Isolated per newspaper, the shift is uniform, so four of six models are mathematically shielded from it, and the two that aren't move by noise. The pooled experiment isn't measuring "does removing the masthead help or hurt" so much as "what happens when you shift three different subsets of a pooled dataset by three different amounts" — a different question, and evidently a worse one.
