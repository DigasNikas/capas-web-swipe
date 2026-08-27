# RAG

K-nearest-neighbor retrieval from [Image Embeddings](#image-embeddings),
folded into the zero-shot classifier's prompt as few-shot context.

## What it does

At classification time, `classifyCover` (`api/lib/ai.js`) embeds the cover
with the same CLIP model `build_vectorize_index.py` used to build the index,
queries `capas-cover-embeddings` for the `RAG_TOP_K` (5) nearest labelled
covers, and prepends their crowd-labelled clubs to the prompt as a short
reference block — before the model reads the actual image. The block
explicitly names the caveat from [Image Embeddings](#image-embeddings):
raw CLIP similarity tracks newspaper layout as much as subject, so it reads
as a weak prior, not a verdict.

The new cover's own embedding is never written back to the index at this
point — it has no crowd vote yet, same rule `build_vectorize_index.py`
already applies. The index keeps growing only through that script, on its
own schedule.

## Why a Space, not Workers AI

Workers AI has no CLIP-compatible image-embedding model, and an in-Worker
ONNX/WASM attempt (`@huggingface/transformers` inside `wrangler dev`) failed
twice — one run errored after 7.5 minutes at 18% of the model download, a
retry stalled at 83% for 15+ minutes and never finished. Hugging Face's own
hosted inference was checked live against a real token and serves no
CLIP-family model on any route. A small self-hosted HF Space
(`clip-space/`, Docker + FastAPI, free CPU tier) turned out to be the only
path to a live per-cover embedding.

## Failure handling

Every new step is optional. If the Space is cold, down, or misconfigured,
or the Vectorize query fails, `classifyCover` falls back to exactly today's
plain zero-shot prompt — `classifyAndStore`'s "never block the scrape"
contract is unchanged.

## Status

Built, not yet measured. `scripts/eval-ai.mjs --rag` is what answers the
real question — does the few-shot context move agreement% at all, given the
layout-not-subject bias already observed. Run it against the deployed Space
once it exists, compare against a plain `scripts/eval-ai.mjs` run on the
same sample, and update this section with the result.
