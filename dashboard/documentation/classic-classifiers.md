# Classic Classifiers

`scripts/train_classic_classifier.py` fits seven classifiers on crowd-labelled covers and scores them on covers they never trained on. It reads `/api/stats` for labels, writes nothing, and is independent of the live AI Detector.

## Method

Both experiments run the same procedure. Only the input features change.

| | |
|---|---|
| Labels | `analytics_covers.club`, 4 classes: `sporting`, `benfica`, `porto`, `others`. Unvoted covers excluded |
| Models | Logistic Regression (`max_iter=1000`), k-Nearest Neighbours (k=5), Decision Tree (depth 10), Random Forest (100 trees), Linear SVM, Gaussian Naive Bayes, Small MLP (PyTorch, one 128-unit hidden layer, 60 epochs, seed 0). sklearn defaults otherwise |
| Splits | Chronological (default): oldest 80% train, newest 20% test. Stratified: random 80/20 keeping class proportions, `random_state=0` |
| Scopes | Pooled (all newspapers together) and per newspaper (`--per-newspaper`, each paper trained and tested on its own covers) |
| Metrics | Accuracy, macro F1, recall per class. Baseline: always predicting the test set's majority class |
| Data | Archive as of 2026-09-15 |

Run through `.github/workflows/classic-experiments.yml`, which uploads `report.json`: every table below comes from those files.

```bash
.venv/bin/python scripts/train_classic_classifier.py --features pixels --split chronological
.venv/bin/python scripts/train_classic_classifier.py --features both --scale --split stratified --per-newspaper --report-json report.json
```

Embedding runs need `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (Vectorize · Read).

## Experiment 1: Raw pixels

| | |
|---|---|
| Examples | **1,869** covers |
| Features | Cover resized to 32×32 RGB, flattened: **3,072** values in `[0, 1]` |
| Preprocessing | None |

### Pooled, chronological

Train 1,495 / test 374. Test set: sporting 81, benfica 128, porto 80, others 85. Majority baseline **34.2%** (benfica).

| Model | Accuracy | Macro F1 |
|---|---|---|
| Random Forest | **62.3%** | 0.53 |
| Logistic Regression | 61.0% | 0.57 |
| Naive Bayes | 61.0% | 0.58 |
| Small MLP (PyTorch) | 60.7% | 0.51 |
| Linear SVM | 56.7% | 0.53 |
| k-Nearest Neighbours | 52.9% | 0.48 |
| Decision Tree | 44.4% | 0.43 |

**Recall per class:**

| Model | sporting | benfica | porto | others |
|---|---|---|---|---|
| Random Forest | 64% | 92% | 76% | 2% |
| Logistic Regression | 73% | 83% | 50% | 27% |
| Naive Bayes | 67% | 79% | 64% | 26% |
| Small MLP (PyTorch) | 72% | 95% | 59% | 0% |
| Linear SVM | 65% | 79% | 48% | 24% |
| k-Nearest Neighbours | 38% | 80% | 68% | 13% |
| Decision Tree | 47% | 56% | 39% | 29% |

### Pooled, stratified

Train 1,495 / test 374. Test set: sporting 97, benfica 127, porto 80, others 70. Majority baseline **34.0%** (benfica).

| Model | Accuracy | Macro F1 |
|---|---|---|
| Small MLP (PyTorch) | **64.7%** | 0.53 |
| Logistic Regression | 64.2% | 0.62 |
| Naive Bayes | 61.8% | 0.58 |
| Random Forest | 61.0% | 0.52 |
| Linear SVM | 59.6% | 0.58 |
| k-Nearest Neighbours | 57.5% | 0.53 |
| Decision Tree | 38.2% | 0.36 |

**Recall per class:**

| Model | sporting | benfica | porto | others |
|---|---|---|---|---|
| Small MLP (PyTorch) | 74% | 89% | 71% | 0% |
| Logistic Regression | 74% | 69% | 64% | 43% |
| Naive Bayes | 75% | 66% | 69% | 27% |
| Random Forest | 71% | 80% | 68% | 6% |
| Linear SVM | 63% | 67% | 60% | 41% |
| k-Nearest Neighbours | 44% | 86% | 54% | 29% |
| Decision Tree | 42% | 49% | 36% | 16% |

### Per newspaper, chronological

| Newspaper | Train | Test | Test set (sporting/benfica/porto/others) | Majority baseline |
|---|---|---|---|---|
| A Bola | 498 | 125 | 32 / 64 / 4 / 25 | 51.2% (benfica) |
| O Jogo | 498 | 125 | 7 / 8 / 71 / 39 | 56.8% (porto) |
| Record | 498 | 125 | 42 / 56 / 6 / 21 | 44.8% (benfica) |

| Model | A Bola | O Jogo | Record |
|---|---|---|---|
| Logistic Regression | 68.0% | 54.4% | **77.6%** |
| k-Nearest Neighbours | 58.4% | 47.2% | 59.2% |
| Decision Tree | 44.8% | 43.2% | 42.4% |
| Random Forest | 63.2% | 57.6% | 76.0% |
| Linear SVM | 64.8% | 50.4% | 74.4% |
| Naive Bayes | 60.0% | 48.8% | 73.6% |
| Small MLP (PyTorch) | **68.8%** | **58.4%** | 76.0% |

### Per newspaper, stratified

| Newspaper | Train | Test | Test set (sporting/benfica/porto/others) | Majority baseline |
|---|---|---|---|---|
| A Bola | 498 | 125 | 36 / 58 / 7 / 24 | 46.4% (benfica) |
| O Jogo | 498 | 125 | 10 / 19 / 67 / 29 | 53.6% (porto) |
| Record | 498 | 125 | 51 / 51 / 6 / 17 | 40.8% (benfica) |

| Model | A Bola | O Jogo | Record |
|---|---|---|---|
| Logistic Regression | 68.8% | 56.0% | 76.8% |
| k-Nearest Neighbours | 57.6% | 51.2% | 60.8% |
| Decision Tree | 42.4% | 40.0% | 48.0% |
| Random Forest | 68.0% | 56.0% | 74.4% |
| Linear SVM | 65.6% | 56.0% | 74.4% |
| Naive Bayes | 61.6% | **58.4%** | 68.8% |
| Small MLP (PyTorch) | **71.2%** | 54.4% | **78.4%** |

### Findings

- Best pooled accuracy 62.3% (chronological) and 64.7% (stratified), against a ~34% baseline.
- `others` recall, chronological: 2% Random Forest, 0% MLP, 29% at best (Decision Tree). Stratified: 43% at best (Logistic Regression).
- Per newspaper, chronological: Record 77.6%, A Bola 68.8%, O Jogo 58.4% against its 56.8% baseline.
- Per newspaper, chronological: Random Forest and the MLP score 0% recall on each paper's two rarest classes.

## Experiment 2: Embeddings

| | |
|---|---|
| Examples | **1,669** covers with both vectors. 1,866 have an image vector, 1,672 a headline vector |
| Features | Read back from Vectorize with `get_by_ids`: CLIP image embedding (`capas-cover-embeddings`, **512**) and multilingual-e5-base lead-headline embedding (`capas-headline-embeddings`, **768**). `--features both` concatenates them: **1,280** |
| Preprocessing | `--scale`: `StandardScaler` fitted on the training split only |

### Feature sets

Pooled, best model per run.

| Features | Dimensions | Covers | Chronological | Stratified | `others` recall, best chronological model |
|---|---|---|---|---|---|
| pixels (Experiment 1) | 3,072 | 1,869 | 62.3% (Random Forest) | 64.7% (Small MLP) | 2% |
| image | 512 | 1,866 | 73.8% (Small MLP) | 79.1% (Small MLP) | 55% |
| headline | 768 | 1,672 | 86.9% (Naive Bayes) | 76.1% (k-NN) | 82% |
| both | 1,280 | 1,669 | **89.2%** (Small MLP) | **85.3%** (Small MLP) | 79% |

The sections below use `both`.

### Pooled, chronological

Train 1,335 / test 334. Test set: sporting 72, benfica 116, porto 68, others 78. Majority baseline **34.7%** (benfica).

| Model | Accuracy | Macro F1 |
|---|---|---|
| Small MLP (PyTorch) | **89.2%** | 0.89 |
| Logistic Regression | 87.7% | 0.87 |
| Naive Bayes | 85.3% | 0.84 |
| Linear SVM | 83.5% | 0.83 |
| k-Nearest Neighbours | 79.0% | 0.77 |
| Random Forest | 74.3% | 0.68 |
| Decision Tree | 58.7% | 0.56 |

**Recall per class:**

| Model | sporting | benfica | porto | others |
|---|---|---|---|---|
| Small MLP (PyTorch) | 89% | 95% | 91% | 79% |
| Logistic Regression | 90% | 93% | 88% | 77% |
| Naive Bayes | 89% | 95% | 88% | 65% |
| Linear SVM | 82% | 91% | 85% | 72% |
| k-Nearest Neighbours | 86% | 95% | 84% | 45% |
| Random Forest | 89% | 97% | 90% | 14% |
| Decision Tree | 69% | 72% | 60% | 27% |

### Pooled, stratified

Train 1,335 / test 334. Test set: sporting 89, benfica 110, porto 73, others 62. Majority baseline **32.9%** (benfica).

| Model | Accuracy | Macro F1 |
|---|---|---|
| Small MLP (PyTorch) | **85.3%** | 0.85 |
| Logistic Regression | 82.9% | 0.82 |
| Linear SVM | 81.1% | 0.80 |
| Naive Bayes | 78.7% | 0.78 |
| k-Nearest Neighbours | 78.1% | 0.76 |
| Random Forest | 77.2% | 0.73 |
| Decision Tree | 49.7% | 0.49 |

**Recall per class:**

| Model | sporting | benfica | porto | others |
|---|---|---|---|---|
| Small MLP (PyTorch) | 83% | 91% | 86% | 77% |
| Logistic Regression | 83% | 86% | 84% | 76% |
| Linear SVM | 85% | 85% | 79% | 69% |
| Naive Bayes | 85% | 77% | 85% | 65% |
| k-Nearest Neighbours | 80% | 88% | 84% | 52% |
| Random Forest | 83% | 93% | 89% | 27% |
| Decision Tree | 57% | 45% | 53% | 44% |

### Per newspaper, chronological

| Newspaper | Train | Test | Test set (sporting/benfica/porto/others) | Majority baseline |
|---|---|---|---|---|
| A Bola | 447 | 112 | 28 / 59 / 3 / 22 | 52.7% (benfica) |
| O Jogo | 444 | 111 | 7 / 8 / 60 / 36 | 54.1% (porto) |
| Record | 444 | 111 | 37 / 49 / 5 / 20 | 44.1% (benfica) |

| Model | A Bola | O Jogo | Record |
|---|---|---|---|
| Logistic Regression | 84.8% | 88.3% | 84.7% |
| k-Nearest Neighbours | 83.0% | 73.0% | 78.4% |
| Decision Tree | 55.4% | 55.0% | 49.5% |
| Random Forest | 75.0% | 62.2% | 74.8% |
| Linear SVM | 83.0% | 83.8% | 77.5% |
| Naive Bayes | 84.8% | 87.4% | 84.7% |
| Small MLP (PyTorch) | **86.6%** | **91.0%** | **85.6%** |

### Per newspaper, stratified

| Newspaper | Train | Test | Test set (sporting/benfica/porto/others) | Majority baseline |
|---|---|---|---|---|
| A Bola | 447 | 112 | 33 / 51 / 6 / 22 | 45.5% (benfica) |
| O Jogo | 444 | 111 | 9 / 15 / 61 / 26 | 55.0% (porto) |
| Record | 444 | 111 | 46 / 44 / 7 / 14 | 41.4% (sporting) |

| Model | A Bola | O Jogo | Record |
|---|---|---|---|
| Logistic Regression | **84.8%** | 82.9% | **82.0%** |
| k-Nearest Neighbours | 76.8% | 75.7% | 78.4% |
| Decision Tree | 60.7% | 52.3% | 54.1% |
| Random Forest | 74.1% | 64.9% | 70.3% |
| Linear SVM | 75.0% | 80.2% | 81.1% |
| Naive Bayes | **84.8%** | **83.8%** | 78.4% |
| Small MLP (PyTorch) | 83.0% | 81.1% | 81.1% |

### Scaling

`both`, pooled, chronological, with and without `--scale`.

| Model | Unscaled | Standardised | `others` recall unscaled → standardised |
|---|---|---|---|
| Logistic Regression | 84.4% | 87.7% | 53% → 77% |
| k-Nearest Neighbours | 77.2% | 79.0% | 37% → 45% |
| Decision Tree | 58.7% | 58.7% | 27% → 27% |
| Random Forest | 74.0% | 74.3% | 13% → 14% |
| Linear SVM | 88.9% | 83.5% | 72% → 72% |
| Naive Bayes | 85.3% | 85.3% | 65% → 65% |
| Small MLP (PyTorch) | 71.3% | 89.2% | 0% → 79% |

### Findings

- `both` beats either embedding alone and beats pixels by 26.9 points (chronological) and 20.6 points (stratified).
- `others` recall, chronological: 79% Small MLP, 77% Logistic Regression. Pixels: 29% at best.
- Per newspaper, chronological, best model: O Jogo 58.4% → 91.0%, A Bola 68.8% → 86.6%, Record 77.6% → 85.6%.
- Standardising moves the MLP from 71.3% to 89.2% and its `others` recall from 0% to 79%. Logistic Regression gains 3.3 points. Linear SVM loses 5.4 points. Decision Tree, Random Forest and Naive Bayes move by at most 0.3 points.
- Random Forest's `others` recall stays between 10% and 30% on every embedding feature set.
- The headline embedding scores 10.8 points lower on the stratified split than on the chronological one. Image and pixels score higher on the stratified split.
