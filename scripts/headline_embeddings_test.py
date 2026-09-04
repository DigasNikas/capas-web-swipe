#!/usr/bin/env python3
"""Self-check for lead_headline: python3 scripts/headline_embeddings_test.py

No model load, no network — this is the text-selection half only.
"""
from headline_embeddings import LEAD_MAX_CHARS, lead_headline

assert lead_headline(None) is None
assert lead_headline("") is None
assert lead_headline("   \n ") is None

# The bulleted shape: capasjornais.pt's own separator, lead story first.
assert lead_headline("Palhinha já é da casa • Zaidu com suspeita de lesão") == "Palhinha já é da casa"

# Whitespace from the source page collapses; the archive backfill's stray
# markup goes with it.
assert lead_headline("Dragões\n\npasseiam   na Beira") == "Dragões passeiam na Beira"
assert lead_headline("Sporting 2-0 Alverca<br>Ciclismo") == "Sporting 2-0 Alverca Ciclismo"

# A leading separator: two covers in the archive (982 and 985, both
# 2025-06-22) start with "• ", so taking split("•")[0] blindly returned an
# empty string and the cover was skipped as unembeddable forever.
assert lead_headline("• Kokçu e a fúria com Bruno Lage • Euro sub-21") == "Kokçu e a fúria com Bruno Lage"
assert lead_headline("•") is None
assert lead_headline(" • • ") is None

# Unseparated rows (45% of the archive) get cut to a budget instead, on a
# word boundary rather than mid-word.
long_lead = "Benfica vence " * 40
cut = lead_headline(long_lead)
assert len(cut) <= LEAD_MAX_CHARS
assert not cut.endswith("Benfic"), "cut on a word boundary"
assert cut.startswith("Benfica vence")

# A single very long word has no boundary to cut on: budget wins, since the
# point is bounding what reaches the model.
assert len(lead_headline("x" * 500)) == LEAD_MAX_CHARS

print("headline_embeddings.py self-check ok")
