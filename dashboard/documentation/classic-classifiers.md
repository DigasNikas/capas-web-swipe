# Classic Classifiers

`scripts/train_classic_classifier.py` is a separate, deliberately old-school exercise: no pretraining, no transfer learning, no OCR, the shape a first ML course teaches before reaching for anything smarter. It doesn't touch D1 or `ai_club`, and isn't meant to compete with the zero-shot model (see [Multimodal](#multimodal)).

The experiment below runs seven classifiers (logistic regression, k-nearest neighbours, a decision tree, a random forest, a linear SVM, naive Bayes, and an optional small from-scratch PyTorch MLP) on the same input, so the comparison is about the algorithm, not the data.

```bash
python3 -m venv .venv && .venv/bin/pip install numpy pillow scikit-learn
.venv/bin/pip install torch          # optional, adds the PyTorch MLP
.venv/bin/python scripts/train_classic_classifier.py
.venv/bin/python scripts/train_classic_classifier.py --limit 200   # quick run
.venv/bin/python scripts/train_classic_classifier.py --per-newspaper
```

Each model gets the same report: accuracy, per-class precision/recall/F1, confusion matrix, followed by a summary table ranked by accuracy.

## Experiment 1: Raw pixels

Fetch `(cover URL, crowd-voted club)` pairs from `/api/stats`, resize each cover to 32×32, flatten to a raw pixel vector. That's the entire feature-engineering step. The split is chronological (train on the older 80%, test on the most recent 20%) rather than random: covers share a masthead template within a stretch of dates, so a random split would let near-duplicate examples leak between train and test.

### Data

| | |
|---|---|
| Examples | **1,555** covers, every one with a crowd vote in `analytics_covers`. Unvoted covers aren't labelled, so they're excluded |
| Representation | 32×32 RGB pixel vector: **3,072 features**, normalized to `[0, 1]`. No crops, no colour histograms, no OCR |
| Split | `--split chronological` (default) or `--split stratified`, both reported below. 80/20: **1,244 train** / **311 test** |
| Labels | 4 classes from `analytics_covers.club`: `benfica`, `sporting`, `porto`, `others` |
| Majority-class baseline | Always guessing `benfica` scores **35.7%** (111/311) |

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

Every model clears the 35.7% baseline, so all seven learn something from raw pixels alone, roughly which club's mean colour palette a cover looks closest to. All seven land well below the zero-shot model's agreement (see [Multimodal](#multimodal)): the real signal is headline text, and none of these seven can read.

**Recall per class:**

| Model | sporting | benfica | porto | others |
|---|---|---|---|---|
| Naive Bayes | 64% | 78% | 61% | **26%** |
| Logistic Regression | 68% | 77% | 41% | 17% |
| Linear SVM | 68% | 76% | 36% | 18% |
| k-Nearest Neighbours | 45% | 84% | 64% | 18% |
| Decision Tree | 55% | 45% | 49% | 23% |
| Random Forest | 67% | 88% | 73% | 2% |
| Small MLP (PyTorch) | 70% | 93% | 63% | **0%** |

`others` collapses for every model, worst for the two with the highest accuracy (Random Forest 2%, the MLP 0%): both default to `benfica`, the largest class, whenever unsure. The zero-shot model has the same weak spot for a related reason: `others` has no consistent visual signature across four different kinds of front page (Seleção, Braga/Guimarães, another sport, a transfer round-up). It can still read the headline and often name the actual story; a pixel-only model that can't read has nothing else to grab onto.

### Results: stratified split

Same 1,555 covers, same 80/20 ratio, same seven models. The only change is `train_test_split(..., stratify=y, random_state=0)` instead of the date cutoff, so the test set's four classes land in their true archive proportions (sporting 83, benfica 107, porto 64, others 57; majority-class baseline **34.4%**).

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

Random Forest scores identically under both splits (62.1%), so that number isn't an artifact of the test set's composition. `others` recall stays near zero for Random Forest (2%→7%) and the MLP (0%→0%) under either split: both models default to the majority class whenever unsure, regardless of how the test set is built. Logistic Regression, Linear SVM and Naive Bayes keep `others` recall in the 25-28% range under stratification instead, spreading mistakes across classes rather than defaulting to one.

### Results: per newspaper

The archive has three newspapers, each a fixed template with identical layout, fonts and colours every issue. Pooling all three lets a model shortcut on "which paper is this" instead of "what does this cover say," since paper and club aren't independent: O Jogo runs Porto far more often than the other two. `--per-newspaper` trains and tests seven fresh models per paper, using only that paper's own covers, so a model can only read the photo and headline, never the masthead.

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

Splitting by newspaper shrinks training data from 1,244 pooled covers to ~410-420 per paper. Record and A Bola still beat the pooled chronological run (62.1%): Record reaches 82.9%, A Bola 69.5%. O Jogo's best model (57.8%) lands below the pooled number and barely above its own 56.9% baseline: for O Jogo, none of these seven pixel-only models find much real signal.

The `others`-recall collapse repeats here too, but generalizes: Random Forest and the MLP collapse toward 0% recall on each paper's two least-represented classes, whatever those happen to be, not `others` specifically. Porto and others in A Bola, sporting and benfica in O Jogo, porto and others in Record. High-accuracy models here default to the majority guess the moment a class gets thin.

### Per newspaper, stratified split

Same per-newspaper isolation, `--split stratified` instead of the date cutoff.

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

Same shape as the chronological per-newspaper run: A Bola (70.5% vs 69.5%) and Record (78.1% vs 82.9%) land in the same range either way. O Jogo moves, clearing its own baseline by +6.9pp (53.9%→60.8%) instead of the chronological run's +0.9pp, so its covers aren't signal-free, just harder in the most recent stretch.

The two-smallest-classes collapse repeats too: Random Forest and the MLP land at 0% recall on each paper's rarest pair, with one exception (the MLP gets 6% on O Jogo's benfica, one correct guess out of 16).
