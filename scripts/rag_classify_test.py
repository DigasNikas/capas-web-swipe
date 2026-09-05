#!/usr/bin/env python3
"""Self-check for rag_classify.py's pure parsing/formatting logic — no
network, no model load. Run: python3 scripts/rag_classify_test.py

Mirrors api/lib/ai.test.mjs's cases for parseAnswer/buildFewShotBlock —
both scripts implement the same logic in different languages and must stay
behaviourally identical (see the "keep in sync by hand" notes in
rag_classify.py). Not a coincidence these tests read almost line-for-line
the same as the JS ones.
"""
from rag_classify import (
    CONSENSUS_MIN,
    RAG_TOP_K,
    build_few_shot_block,
    build_headlines_block,
    consensus_club,
    merge_channels,
    parse_answer,
    rag_cover_ids_from_matches,
    rag_sources_from_matches,
    usable_matches,
)

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
assert build_few_shot_block([{"metadata": {}}, {"metadata": {"club": None}}]) == ""

block = build_few_shot_block([
    {"metadata": {"club": "sporting"}, "via": "layout"},
    {"metadata": {"club": "sporting"}, "via": "headline"},
    {"metadata": {"club": "benfica"}, "via": "layout"},
])
assert "2 sporting, 1 benfica" in block
assert "1 matched by headline wording, 2 by page layout" in block
assert "weak prior" in block

# Ties break by CLUBS order, so the same neighbours always build the same
# prompt whichever order retrieval returned them in.
assert build_few_shot_block([{"metadata": {"club": "porto"}}, {"metadata": {"club": "benfica"}}]) == \
       build_few_shot_block([{"metadata": {"club": "benfica"}}, {"metadata": {"club": "porto"}}])

assert "both matched by page layout" in build_few_shot_block([
    {"metadata": {"club": "porto"}, "via": "layout"},
    {"metadata": {"club": "porto"}, "via": "layout"},
])
assert "page layout" in build_few_shot_block([{"metadata": {"club": "benfica"}}]), "no via means layout"

# Self-match guard, unchanged by the second channel.
assert build_few_shot_block([{"metadata": {"club": "benfica"}, "score": 0.99999}]) == ""

# --- rag_cover_ids_from_matches ---
#
# Same filter as build_few_shot_block, so the ids stored as provenance are
# exactly the covers whose clubs the prompt was built from.

assert rag_cover_ids_from_matches([]) == []
assert rag_cover_ids_from_matches(None) == []
assert rag_cover_ids_from_matches([{"id": "1", "metadata": {}}]) == []
assert rag_cover_ids_from_matches([{"id": "1", "metadata": {"club": "benfica"}, "score": 0.99999}]) == []
assert rag_cover_ids_from_matches([
    {"id": "1", "metadata": {"club": "benfica"}, "score": 0.99999},
    {"id": "2", "metadata": {"club": "sporting"}, "score": 0.87},
    {"id": "3", "metadata": {"club": "porto"}, "score": 0.81},
]) == ["2", "3"]

# --- rag_sources_from_matches ---
#
# Index-aligned with rag_cover_ids_from_matches: ai_rag_covers[i] was found by
# ai_rag_source[i]. Drift between them mislabels a channel on /similarities,
# silently and permanently.

MIXED = [
    {"id": "1", "metadata": {"club": "benfica"}, "score": 0.99999, "via": "headline"},
    {"id": "2", "metadata": {}, "via": "headline"},
    {"id": "3", "metadata": {"club": "sporting"}, "score": 0.9, "via": "headline"},
    {"id": "4", "metadata": {"club": "porto"}, "score": 0.8, "via": "layout"},
]
assert rag_cover_ids_from_matches(MIXED) == ["3", "4"]
assert rag_sources_from_matches(MIXED) == ["headline", "layout"]
assert rag_sources_from_matches([]) == []
assert rag_sources_from_matches([{"id": "1", "metadata": {"club": "porto"}}]) == ["layout"]

# --- usable_matches ---

MATCHES = [
    {"id": "1", "score": 0.99999, "metadata": {"club": "benfica", "date": "2025-01-02"}},
    {"id": "2", "score": 0.91, "metadata": {"club": "porto", "date": "2025-01-01"}},
    {"id": "3", "score": 0.88, "metadata": {"club": None, "date": "2025-01-03"}},
    {"id": "4", "score": 0.80, "metadata": {"club": "sporting", "date": "2025-01-04"}},
]

kept = usable_matches(MATCHES, "headline", cover_date="2025-01-01")
assert [m["id"] for m in kept] == ["4"], "drops the self-match, the unlabelled one, and the same-day sibling"
assert kept[0]["via"] == "headline"

# Without a date to compare against, only the score and label rules apply.
assert [m["id"] for m in usable_matches(MATCHES, "layout", cover_date=None)] == ["2", "4"]
assert usable_matches(None, "layout", None) == []

# --- merge_channels ---

h = [{"id": "h1"}, {"id": "h2"}, {"id": "h3"}]
i = [{"id": "i1"}, {"id": "i2"}, {"id": "i3"}]
assert [m["id"] for m in merge_channels(h, i)] == ["h1", "i1", "h2", "i2", "h3", "i3"], "alternates, headline first"

# The cap is RAG_TOP_K, and it cuts mid-alternation rather than truncating
# one channel: with top_k=3 that is two headline matches and one image.
assert [m["id"] for m in merge_channels(h, i, top_k=3)] == ["h1", "i1", "h2"]
many_h = [{"id": f"H{n}"} for n in range(10)]
many_i = [{"id": f"I{n}"} for n in range(10)]
assert len(merge_channels(many_h, many_i)) == RAG_TOP_K, "default cap is RAG_TOP_K, not a hardcoded number"

# A cover both channels found appears once, credited to the channel that is
# the better reason for it being there.
dup = merge_channels([{"id": "x", "via": "headline"}], [{"id": "x", "via": "layout"}])
assert len(dup) == 1 and dup[0]["via"] == "headline"

# Either channel empty still fills from the other — a cover with no scraped
# headlines gets image matches alone, exactly as before this index existed.
assert [m["id"] for m in merge_channels([], i)] == ["i1", "i2", "i3"]
assert [m["id"] for m in merge_channels(h, [])] == ["h1", "h2", "h3"]

# --- build_headlines_block ---
#
# Mirrors api/lib/ai.js's buildHeadlinesBlock. Live mode never calls this (the
# Worker reads covers.headlines from D1 itself), --eval does, and --eval only
# means anything if the prompt it scores is the prompt production sends.

assert build_headlines_block(None) == ""
assert build_headlines_block("") == ""
assert build_headlines_block("   \n  ") == ""

block = build_headlines_block("Palhinha ja e da casa • Zaidu com suspeita de lesao")
assert "Palhinha ja e da casa • Zaidu com suspeita de lesao" in block
assert "does not decide the answer" in block
assert block.endswith("\n\n")

assert "Dragoes passeiam na Beira" in build_headlines_block("Dragoes\n\npasseiam   na Beira")

long_text = "cabecalho " * 200 + "FIMDOTEXTO"
block = build_headlines_block(long_text)
assert "FIMDOTEXTO" not in block
assert "\u2026" in block
assert len(block) < len(long_text)

# --- consensus_club ---
#
# Mirrors api/lib/ai.js's consensusClub. The threshold is measured: over all
# 1836 crowd-labelled covers, a 6-of-7 bloc is right 94% of the time and a
# 5-of-7 bloc 85%, against the classifier's own 91.2%.

assert consensus_club([]) is None
assert consensus_club(None) is None

assert consensus_club(
    [{"metadata": {"club": "porto"}}] * 6 + [{"metadata": {"club": "benfica"}}]
) == {"club": "porto", "agreed": 6, "of": 7}

assert consensus_club(
    [{"metadata": {"club": "porto"}}] * 5
    + [{"metadata": {"club": "benfica"}}, {"metadata": {"club": "sporting"}}]
) is None

# Six of six is stronger than six of seven, not weaker.
assert consensus_club([{"metadata": {"club": "sporting"}}] * 6) == {
    "club": "sporting", "agreed": 6, "of": 6,
}

# Self-matches cannot vote, same filter as the few-shot block.
assert consensus_club([{"metadata": {"club": "porto"}, "score": 0.99999}] * 7) is None
assert CONSENSUS_MIN <= RAG_TOP_K, "an unreachable threshold would silently disable the fast path"

print("rag_classify.py self-check ok")
