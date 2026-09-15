"""Score one cover with the exported `others`-gate model.

The weights come from scripts/backfill_lr_probabilities.py --export: a
StandardScaler's mean and scale, plus a multinomial logistic regression's
coefficients, over the 512 CLIP dimensions followed by the 768 e5 ones. The
same two vectors rag_classify.py already computed for retrieval, so scoring a
cover costs a dot product and no network call.

Returns None rather than guessing whenever it cannot score honestly: no
weights file, no headline vector, or a vector of the wrong width. The gate is
off for that cover and the model's own answer stands -- see api/lib/gate.js.
"""
import json
import math
import os

import numpy as np


def load_model(path):
    if not path or not os.path.exists(path):
        return None
    with open(path) as f:
        m = json.load(f)
    m["mean"] = np.asarray(m["mean"], dtype=np.float64)
    m["scale"] = np.asarray(m["scale"], dtype=np.float64)
    m["coef"] = np.asarray(m["coef"], dtype=np.float64)
    m["intercept"] = np.asarray(m["intercept"], dtype=np.float64)
    return m


def score(model, image_vector, headline_vector):
    """{club: probability, ..., "asof": date} or None."""
    if model is None or image_vector is None or headline_vector is None:
        return None
    x = np.concatenate([np.asarray(image_vector, dtype=np.float64),
                        np.asarray(headline_vector, dtype=np.float64)])
    if x.shape[0] != model["mean"].shape[0]:
        return None

    z = model["coef"] @ ((x - model["mean"]) / model["scale"]) + model["intercept"]
    # Two classes come back as one row of coefficients, the rest as one per
    # class -- sklearn's own convention, and the softmax below would turn a
    # single row into a certainty of 1.0 if it were not special-cased.
    if z.shape[0] == 1:
        p1 = 1.0 / (1.0 + math.exp(-float(z[0])))
        probs = [1.0 - p1, p1]
    else:
        e = np.exp(z - z.max())
        probs = (e / e.sum()).tolist()

    out = {c: float(p) for c, p in zip(model["classes"], probs)}
    out["asof"] = model["asof"]
    return out
