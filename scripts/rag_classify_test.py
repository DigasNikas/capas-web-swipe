#!/usr/bin/env python3
"""Self-check for rag_classify.py's pure parsing/formatting logic — no
network, no model load. Run: python3 scripts/rag_classify_test.py

Mirrors api/lib/ai.test.mjs's cases for parseAnswer/buildFewShotBlock —
both scripts implement the same logic in different languages and must stay
behaviourally identical (see the "keep in sync by hand" notes in
rag_classify.py). Not a coincidence these tests read almost line-for-line
the same as the JS ones.
"""
from rag_classify import build_few_shot_block, parse_answer

# --- parse_answer ---

assert parse_answer("HEADLINE: MEIO BILHETE\nANSWER: benfica") == {
    "club": "benfica", "headline": "MEIO BILHETE", "why": None,
}

assert parse_answer("HEADLINE: MEIO BILHETE\nWHY: Benfica named in the headline\nANSWER: benfica") == {
    "club": "benfica", "headline": "MEIO BILHETE", "why": "Benfica named in the headline",
}

assert parse_answer("HEADLINE: X\nAnswer: **Sporting**")["club"] == "sporting"

assert parse_answer("The page is dominated by a Sporting win over Porto.") == {
    "club": None, "headline": None, "why": None,
}

assert parse_answer("HEADLINE: LEAO RUGE EM ALVALADE E O BENFICA")["club"] is None

# Position, not CLUBS order.
assert parse_answer("ANSWER: porto (not benfica)")["club"] == "porto"

assert parse_answer("HEADLINE: BENFICA HUMILHADO\nANSWER: others")["club"] == "others"

assert parse_answer("ANSWER: <benfica|sporting|porto|others>\nHEADLINE: DRAGAO VOA\nANSWER: porto")["club"] == "porto"

assert parse_answer(None) == {"club": None, "headline": None, "why": None}
assert parse_answer("ANSWER: liverpool")["club"] is None

# --- build_few_shot_block ---

# No matches: no block.
assert build_few_shot_block([]) == ""
assert build_few_shot_block(None) == ""

# Matches with no usable label are dropped, not counted as signal.
assert build_few_shot_block([{"metadata": {}}, {"metadata": {"club": None}}]) == ""

# A cover's own near-identical match (score >= 0.999) never appears, alone
# or mixed with real matches — this is the self-vote-leakage guard.
assert build_few_shot_block([{"score": 0.99999, "metadata": {"club": "porto"}}]) == ""

block = build_few_shot_block([
    {"score": 0.99999, "metadata": {"club": "benfica"}},
    {"score": 0.87, "metadata": {"club": "sporting"}},
    {"score": 0.81, "metadata": {"club": "porto"}},
])
assert "benfica" not in block
assert "sporting, porto" in block
assert "weak prior" in block

print("rag_classify.py self-check ok")
