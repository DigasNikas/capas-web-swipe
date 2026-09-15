"""Self-check: .venv/bin/python scripts/lr_gate_test.py (run from scripts/, or with
scripts/ on the path -- it imports lr_gate the same way rag_classify.py does)."""
import json
import os
import tempfile

import numpy as np

from lr_gate import load_model, score

tmp = tempfile.mkdtemp()
path = os.path.join(tmp, "m.json")

# Two features standing in for the 1280 real ones: the maths is the same.
with open(path, "w") as f:
    json.dump({
        "features": ["image", "headline"], "classes": ["benfica", "others", "porto", "sporting"],
        "mean": [0.0, 0.0], "scale": [1.0, 1.0],
        "coef": [[1, 0], [0, 4], [-1, 0], [0, -1]], "intercept": [0, 0, 0, 0],
        "trained_on": 3, "asof": "2026-09-15",
    }, f)

m = load_model(path)
p = score(m, [0.0], [1.0])
assert abs(sum(v for k, v in p.items() if k != "asof") - 1.0) < 1e-9, "probabilities must sum to 1"
assert max((k for k in p if k != "asof"), key=lambda k: p[k]) == "others"
assert p["asof"] == "2026-09-15"

# Missing either vector, or a wrong width, scores nothing rather than guessing.
assert score(m, None, [1.0]) is None
assert score(m, [0.0], None) is None
assert score(m, [0.0, 0.0], [1.0]) is None, "a vector of the wrong width must not be scored"
assert score(None, [0.0], [1.0]) is None
assert load_model(os.path.join(tmp, "absent.json")) is None
assert load_model(None) is None

# Binary weights come back as one coefficient row; softmaxing that would
# report 1.0 for whichever class happened to be listed second.
with open(path, "w") as f:
    json.dump({"features": ["image", "headline"], "classes": ["a club", "others"],
               "mean": [0.0, 0.0], "scale": [1.0, 1.0], "coef": [[0, 0]], "intercept": [0.0],
               "trained_on": 3, "asof": "2026-09-15"}, f)
p = score(load_model(path), [0.0], [0.0])
assert abs(p["others"] - 0.5) < 1e-9 and abs(p["a club"] - 0.5) < 1e-9, p

print("ok")
