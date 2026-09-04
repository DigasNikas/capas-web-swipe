#!/usr/bin/env python3
"""Shared pieces for the headline text index (capas-headline-embeddings):
which part of covers.headlines gets embedded, and the model that embeds it.

Imported by build_headline_index.py (builds the index) and rag_classify.py
(queries it at classify time). Shared rather than copied because a query
vector produced differently from the indexed vectors silently skews every
cosine similarity against them — the same trap embed() in
build_vectorize_index.py and rag_classify.py already warn about for CLIP.

The model is multilingual-e5-base, run locally through plain transformers
(mean pooling + L2 normalize) rather than adding the sentence-transformers
dependency: torch and transformers are already installed for CLIP in both
the venv and the workflows.

Picked by measurement, not reputation. Over the 1446 covers that have both
a lead headline and a crowd label, asking each model for the nearest other
cover (excluding the same date, since the three papers print the same story
the same day) and reading that neighbour's crowd label:

    always guess the most common club       33.2%
    paraphrase-multilingual-MiniLM-L12-v2   58.8%   (top-5 majority 61.0%)
    paraphrase-multilingual-mpnet-base-v2   60.4%   (top-5 majority 63.0%)
    multilingual-e5-base                    65.6%   (top-5 majority 69.8%)

Worth the extra ~600MB of download in the workflow. Note what the ceiling
says about the feature: a text neighbour agrees with the crowd about two
thirds of the time, which is a weak prior and nothing more — the few-shot
block says exactly that, and should keep saying it.

e5 expects a prefix on its input. "query: " on both sides is the symmetric
usage (headline against headline, not query against document), and is what
the numbers above were measured with; changing it changes them.

Portuguese is the whole reason for a multilingual model. CLIP's own text
encoder would have reused the model already loaded and the index already
built, but it is English-centric with a 77-token cap, which is the wrong
tool for a Record front page. One thing no multilingual model here does
well: none of them know Águias means Benfica, so a cover headlined only by
nickname retrieves poorly. 94% of covers name the club outright, which is
why this works at all.
"""
import re

import numpy as np
import torch
from transformers import AutoModel, AutoTokenizer

TEXT_MODEL_NAME = "intfloat/multilingual-e5-base"
TEXT_DIMS = 768  # capas-headline-embeddings is created with this, cosine
E5_PREFIX = "query: "  # see the module docstring: symmetric usage, both sides

# How much of the lead story to embed. Measured over the 1451 covers that
# have headlines: 790 use capasjornais.pt's "•" separator, and for those the
# first segment is the lead story (it matches the headline the vision model
# reads off the largest photo 95% of the time, median 155 characters). The
# other 661 arrived through the historical archive backfill as one
# unseparated run of several titles, so there is no separator to cut on and a
# character budget is the only thing left. 240 covers the lead in both shapes
# without pulling the second and third stories in behind it.
LEAD_MAX_CHARS = 240


def lead_headline(headlines):
    """The lead story's title, or None when there is nothing to embed.

    Not the whole headlines string: that is every title on the page, side
    rails and teasers included, and embedding it buries the day's subject
    under items the classifier is explicitly told to ignore."""
    text = re.sub(r"<[^>]+>", " ", str(headlines or ""))   # archive rows carry the odd <br>
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return None

    lead = text.split("•")[0].strip()
    if not lead:
        return None
    if len(lead) <= LEAD_MAX_CHARS:
        return lead

    # Cut on a word boundary so the last token fed to the model is a real
    # word rather than half of one.
    cut = lead[:LEAD_MAX_CHARS]
    space = cut.rfind(" ")
    return (cut[:space] if space > LEAD_MAX_CHARS // 2 else cut).strip()


def load_text_model(token=None):
    tokenizer = AutoTokenizer.from_pretrained(TEXT_MODEL_NAME, token=token)
    model = AutoModel.from_pretrained(TEXT_MODEL_NAME, token=token)
    model.eval()
    return model, tokenizer


def embed_text(model, tokenizer, text):
    """Mean-pooled token embeddings, L2-normalized — the same recipe on both
    sides of the index, which is the only thing that makes cosine similarity
    between a query and the stored vectors mean anything."""
    batch = tokenizer(E5_PREFIX + text, padding=True, truncation=True, max_length=128, return_tensors="pt")
    with torch.no_grad():
        out = model(**batch)

    mask = batch["attention_mask"].unsqueeze(-1).float()
    summed = (out.last_hidden_state * mask).sum(dim=1)
    vec = (summed / mask.sum(dim=1).clamp(min=1e-9))[0].numpy()
    return (vec / np.linalg.norm(vec)).tolist()
