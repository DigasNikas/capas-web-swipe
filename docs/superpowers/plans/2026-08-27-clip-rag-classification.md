# CLIP-RAG Cover Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Task 5 is manual/human-only — do not execute it autonomously.**

**Goal:** Ground the zero-shot Llama4 cover classifier in visually similar past covers, retrieved live from the existing `capas-cover-embeddings` Vectorize index, via a self-hosted CLIP-embedding HF Space.

**Architecture:** A minimal FastAPI Space embeds each cover with CLIP at classification time; the Worker queries Vectorize for the K nearest labelled covers and folds their club labels into the Llama4 prompt as a few-shot block; every new step fails soft to today's plain zero-shot behavior.

**Tech Stack:** Cloudflare Workers (JS), Cloudflare Vectorize, Cloudflare Workers AI (Llama4), Hugging Face Spaces (Docker + FastAPI + `transformers`/CLIP, Python).

**Spec:** `docs/superpowers/specs/2026-08-27-clip-rag-classification-design.md`

## Global Constraints

- Embedding model must be `openai/clip-vit-base-patch32` with identical preprocessing/normalization to `scripts/build_vectorize_index.py`'s `embed()` — any drift silently skews cosine similarity against the existing index.
- `classifyAndStore` in `api/lib/ai.js` must never throw — a cold/down/unauthorized Space or a Vectorize failure degrades to today's plain zero-shot prompt, never blocks the daily scrape.
- `PROMPT` stays exported from `api/lib/ai.js` unchanged — it's the zero-shot baseline `scripts/eval-ai.mjs` scores against.
- `RAG_TOP_K = 5`.
- Space auth: header `X-Api-Key` compared against env var `SPACE_API_KEY`.
- Worker → Space call timeout: 8000ms via `AbortController`.
- No new npm dependencies in `api/` — the Worker side is `fetch` + the new `VECTORIZE` binding, nothing else.

---

### Task 1: HF Space — CLIP embedding service

**Files:**
- Create: `clip-space/app.py`
- Create: `clip-space/requirements.txt`
- Create: `clip-space/Dockerfile`
- Create: `clip-space/README.md`
- Create: `clip-space/test_embed.py`

**Interfaces:**
- Produces: `POST /embed` (header `X-Api-Key`, raw image bytes body) → `{"embedding": [512 floats]}` on success, `401`/`400` on auth/decode failure. `GET /` → `{"status": "ok"}`. This is what Task 3's `embedCover()` calls.

- [ ] **Step 1: Write `clip-space/app.py`**

```python
"""CLIP image-embedding service for the capas RAG classifier.

Loads openai/clip-vit-base-patch32 once at import time and exposes one
route: POST /embed, raw image bytes in, a 512-dim L2-normalized vector out.
The embedding logic here is copied verbatim from
scripts/build_vectorize_index.py's embed() in the main repo — same model,
same preprocessing, same normalization — so the vectors this returns land
in the same space as the ones already in the capas-cover-embeddings
Vectorize index. Any drift here silently skews cosine similarity against
that index.
"""
import io
import os

import numpy as np
import torch
from fastapi import FastAPI, Header, HTTPException, Request
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

MODEL_NAME = "openai/clip-vit-base-patch32"
API_KEY = os.environ.get("SPACE_API_KEY")

app = FastAPI()

print(f"loading {MODEL_NAME}...")
model = CLIPModel.from_pretrained(MODEL_NAME)
processor = CLIPProcessor.from_pretrained(MODEL_NAME)
model.eval()
print("model loaded")


def embed(image: Image.Image) -> list[float]:
    """CLIP's image projection, L2-normalized. .pooler_output is the
    projected (1, 512) embedding; indexing the model output directly lands
    on last_hidden_state, the pre-projection per-patch output — not this."""
    inputs = processor(images=image, return_tensors="pt")
    with torch.no_grad():
        out = model.get_image_features(**inputs)
    vec = out.pooler_output[0].numpy()
    return (vec / np.linalg.norm(vec)).tolist()


@app.get("/")
def health():
    return {"status": "ok"}


@app.post("/embed")
async def embed_route(request: Request, x_api_key: str = Header(default=None)):
    if not API_KEY or x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="bad or missing X-Api-Key")

    body = await request.body()
    try:
        image = Image.open(io.BytesIO(body)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="unreadable image")

    return {"embedding": embed(image)}
```

- [ ] **Step 2: Write `clip-space/requirements.txt`**

```
fastapi==0.115.0
uvicorn[standard]==0.32.0
torch==2.4.1
transformers==4.44.2
pillow==10.4.0
numpy==1.26.4
```

- [ ] **Step 3: Write `clip-space/Dockerfile`**

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
```

- [ ] **Step 4: Write `clip-space/README.md`**

```markdown
---
title: Capas CLIP Embed
emoji: 🗞️
colorFrom: blue
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

Internal CLIP (`openai/clip-vit-base-patch32`) image-embedding service for
the capas-web-swipe cover-classification RAG pipeline. Not a public API —
`POST /embed` requires an `X-Api-Key` header matching the `SPACE_API_KEY`
secret.
```

- [ ] **Step 5: Write `clip-space/test_embed.py`**

```python
"""Self-check for app.py's embed() — no network, no server, no HF download
beyond the model itself. Run: python3 clip-space/test_embed.py
"""
import math

from PIL import Image

from app import embed

img = Image.new("RGB", (224, 224), color=(120, 60, 200))
vec = embed(img)

assert len(vec) == 512, f"expected 512 dims, got {len(vec)}"
norm = math.sqrt(sum(x * x for x in vec))
assert abs(norm - 1.0) < 1e-4, f"expected L2 norm ~1, got {norm}"

print("clip-space embed() ok — 512 dims, norm", round(norm, 6))
```

- [ ] **Step 6: Install deps and run the self-check**

```bash
cd clip-space
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python test_embed.py
```

Expected: `clip-space embed() ok — 512 dims, norm 1.0` (first run downloads
the ~600MB CLIP weights, same as `build_vectorize_index.py`'s first run).

- [ ] **Step 7: Commit**

```bash
git add clip-space/
git commit -m "Add HF Space: CLIP image-embedding service for RAG classification"
```

---

### Task 2: `api/lib/ai.js` — embed, retrieve, augment the prompt

**Files:**
- Modify: `api/lib/ai.js`
- Modify: `api/lib/ai.test.mjs`
- Modify: `wrangler.toml`
- Modify: `api/index.js:1-14` (header comment)
- Modify: `api/README.md`

**Interfaces:**
- Consumes: HF Space `POST /embed` from Task 1 (`{"embedding": [...]}`).
- Produces: `RAG_TOP_K` (number), `embedCover(env, buffer) → Promise<number[]|null>`, `buildFewShotBlock(matches) → string`, both exported from `api/lib/ai.js` — Task 3 (`scripts/eval-ai.mjs`) imports `RAG_TOP_K` and `buildFewShotBlock`.

- [ ] **Step 1: Add failing tests to `api/lib/ai.test.mjs`**

Change the import line from:

```js
import { parseAnswer } from "./ai.js";
```

to:

```js
import { parseAnswer, buildFewShotBlock } from "./ai.js";
```

Add before the final `console.log` line:

```js
// No matches: no few-shot block, prompt stays exactly the zero-shot baseline.
assert.equal(buildFewShotBlock([]), "");
assert.equal(buildFewShotBlock(undefined), "");

// Matches with no usable label are dropped, not counted as signal.
assert.equal(buildFewShotBlock([{ metadata: {} }, { metadata: { club: null } }]), "");

// Real matches: every club listed, in order, and the layout-bias caveat present.
{
  const block = buildFewShotBlock([
    { metadata: { club: "sporting" } },
    { metadata: { club: "sporting" } },
    { metadata: { club: "benfica" } },
  ]);
  assert.ok(block.includes("sporting, sporting, benfica"), "lists every club in order");
  assert.ok(block.includes("weak prior"), "carries the layout-bias caveat");
}
```

Change the final line from `console.log("ai parser ok");` to:

```js
console.log("ai.js self-check ok");
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
node api/lib/ai.test.mjs
```

Expected: fails — `buildFewShotBlock` is not exported yet (`SyntaxError` or `TypeError: buildFewShotBlock is not a function`).

- [ ] **Step 3: Add `RAG_TOP_K`, `embedCover`, `buildFewShotBlock` to `api/lib/ai.js`**

Insert this after `parseAnswer` and before `classifyCover`:

```js
// How many similar past covers to pull as few-shot context. Small on
// purpose: enough to show a majority signal, small enough not to crowd out
// the actual instructions.
export const RAG_TOP_K = 5;

// A cold Space can take a while to answer; this must never stall the scrape
// past reason, so an unresponsive Space just means no few-shot context this
// round, not a blocked classification.
const EMBED_TIMEOUT_MS = 8000;

// Embeds a cover the same way scripts/build_vectorize_index.py and
// clip-space/app.py do — same model, same preprocessing — so the vector
// this returns lands in the same space as capas-cover-embeddings. Never
// throws: a cold/down/unauthorized Space just means no RAG context this
// round, same "never block the scrape" contract as classifyAndStore below.
export async function embedCover(env, buffer) {
  if (!env.CLIP_SPACE_URL || !env.CLIP_SPACE_KEY) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
  try {
    const res = await fetch(env.CLIP_SPACE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-Api-Key": env.CLIP_SPACE_KEY },
      body: buffer,
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const { embedding } = await res.json();
    return Array.isArray(embedding) ? embedding : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Turns Vectorize matches into a short few-shot block, or "" if there's
// nothing usable. The caveat line matters: image-embeddings.md's own
// findings show raw CLIP similarity tracks newspaper layout as much as
// subject, so this must read as a weak prior, not a verdict, or the model
// will over-trust it.
export function buildFewShotBlock(matches) {
  const clubs = (matches ?? []).map(m => m.metadata?.club).filter(Boolean);
  if (!clubs.length) return "";

  return (
    `Reference: ${clubs.length} visually similar past front pages from this archive ` +
    `were crowd-labelled: ${clubs.join(", ")}. Visual similarity here tracks newspaper ` +
    "layout as much as subject matter — treat this only as a weak prior, not a verdict.\n\n"
  );
}
```

- [ ] **Step 4: Wire it into `classifyCover`**

Replace:

```js
export async function classifyCover(env, buffer, contentType = "image/jpeg") {
  const res = await env.AI.run(MODEL, {
    messages: [{
      role: "user",
      content: [
        { type: "text", text: PROMPT },
        { type: "image_url", image_url: { url: `data:${contentType};base64,${toBase64(buffer)}` } },
      ],
    }],
    max_tokens: 300,
    temperature: 0.2,
  });

  return parseAnswer(res?.response);
}
```

with:

```js
export async function classifyCover(env, buffer, contentType = "image/jpeg") {
  let fewShot = "";
  const vector = await embedCover(env, buffer);
  if (vector && env.VECTORIZE) {
    try {
      const { matches } = await env.VECTORIZE.query(vector, { topK: RAG_TOP_K, returnMetadata: true });
      fewShot = buildFewShotBlock(matches);
    } catch {
      fewShot = "";
    }
  }

  const res = await env.AI.run(MODEL, {
    messages: [{
      role: "user",
      content: [
        { type: "text", text: fewShot + PROMPT },
        { type: "image_url", image_url: { url: `data:${contentType};base64,${toBase64(buffer)}` } },
      ],
    }],
    max_tokens: 300,
    temperature: 0.2,
  });

  return parseAnswer(res?.response);
}
```

- [ ] **Step 5: Run the test again to confirm it passes**

```bash
node api/lib/ai.test.mjs
```

Expected: `ai.js self-check ok`

- [ ] **Step 6: Add the Vectorize binding to `wrangler.toml`**

Add after the `[ai]` block:

```toml
[[vectorize]]
binding    = "VECTORIZE"
index_name = "capas-cover-embeddings"
```

- [ ] **Step 7: Update the env var header in `api/index.js`**

Replace:

```js
 * Bindings required (set in wrangler.toml):
 *   COVERS_BUCKET  — R2 bucket
 *   DB             — D1 database
 *   IMAGES         — Cloudflare Images (thumbnail generation)
 *   AI             — Workers AI (zero-shot cover classification)
 *
 * Env vars required (set via: wrangler secret put <NAME>):
 *   ADMIN_SECRET   — bearer token for the /scrape, /backfill-* and /notify endpoints
 *   R2_PUBLIC_URL  — public base URL for the R2 bucket (no trailing slash)
 *   RESEND_API_KEY — Resend API key for sending notification emails
 */
```

with:

```js
 * Bindings required (set in wrangler.toml):
 *   COVERS_BUCKET  — R2 bucket
 *   DB             — D1 database
 *   IMAGES         — Cloudflare Images (thumbnail generation)
 *   AI             — Workers AI (zero-shot cover classification)
 *   VECTORIZE      — Vectorize index capas-cover-embeddings (RAG few-shot retrieval)
 *
 * Env vars required (set via: wrangler secret put <NAME>):
 *   ADMIN_SECRET   — bearer token for the /scrape, /backfill-* and /notify endpoints
 *   R2_PUBLIC_URL  — public base URL for the R2 bucket (no trailing slash)
 *   RESEND_API_KEY — Resend API key for sending notification emails
 *   CLIP_SPACE_URL — HF Space /embed endpoint (RAG few-shot retrieval; classification
 *                    degrades to plain zero-shot if unset)
 *   CLIP_SPACE_KEY — shared secret sent as X-Api-Key to the Space
 */
```

- [ ] **Step 8: Update the `lib/` table in `api/README.md`**

Replace:

```
| `ai.js` | Zero-shot cover classification (Workers AI) |
```

with:

```
| `ai.js` | Cover classification: Llama4 zero-shot + Vectorize/HF-Space RAG few-shot |
```

- [ ] **Step 9: Commit**

```bash
git add api/lib/ai.js api/lib/ai.test.mjs wrangler.toml api/index.js api/README.md
git commit -m "Add RAG few-shot retrieval to cover classification"
```

---

### Task 3: `scripts/eval-ai.mjs` — measure whether RAG actually helps

**Files:**
- Modify: `scripts/eval-ai.mjs`

**Interfaces:**
- Consumes: `RAG_TOP_K`, `buildFewShotBlock` from `api/lib/ai.js` (Task 2). `CLIP_SPACE_URL`/`CLIP_SPACE_KEY` env vars (same values as the Worker's secrets, set manually in Task 6). Vectorize's REST `query` endpoint (needs a Cloudflare token with **Vectorize · Read**, in addition to the **Workers AI · Read** this script already requires).
- Produces: `--rag` CLI flag. No exports — this is a standalone script.

- [ ] **Step 1: Update the import line**

Replace:

```js
import { MODEL, PROMPT, CLUBS, parseAnswer, toBase64 } from "../api/lib/ai.js";
```

with:

```js
import { MODEL, PROMPT, CLUBS, parseAnswer, toBase64, RAG_TOP_K, buildFewShotBlock } from "../api/lib/ai.js";
```

- [ ] **Step 2: Add the `--rag` flag and its required env vars, after the existing `ACCOUNT`/`TOKEN` check**

Insert after the existing block:

```js
if (!ACCOUNT || !TOKEN) {
  console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Workers AI · Read).");
  process.exit(1);
}
```

add:

```js
const RAG = process.argv.includes("--rag");
const SPACE_URL = process.env.CLIP_SPACE_URL;
const SPACE_KEY = process.env.CLIP_SPACE_KEY;

if (RAG && (!SPACE_URL || !SPACE_KEY)) {
  console.error("--rag also needs CLIP_SPACE_URL and CLIP_SPACE_KEY (same values as the Worker's secrets), " +
    "and CLOUDFLARE_API_TOKEN needs Vectorize · Read on top of Workers AI · Read.");
  process.exit(1);
}

async function embedViaSpace(img) {
  const res = await fetch(SPACE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "X-Api-Key": SPACE_KEY },
    body: img,
  });
  if (!res.ok) throw new Error(`Space embed HTTP ${res.status}: ${await res.text()}`);
  const { embedding } = await res.json();
  return embedding;
}

async function queryVectorize(vector) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/vectorize/v2/indexes/capas-cover-embeddings/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ vector, topK: RAG_TOP_K, returnMetadata: true }),
    },
  ).then(r => r.json());
  if (!res.success) throw new Error(`Vectorize query failed: ${JSON.stringify(res.errors)}`);
  return res.result.matches;
}
```

- [ ] **Step 3: Use it in `classify()`**

Replace:

```js
async function classify(url) {
  const img = await browserFetch(url).then(r => r.arrayBuffer());
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${MODEL}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${toBase64(img)}` } },
        ],
      }],
      max_tokens: 300,
      temperature: 0.2,
    }),
  }).then(r => r.json());

  if (!res.success) throw new Error(JSON.stringify(res.errors ?? res));
  return parseAnswer(res.result?.response);
}
```

with:

```js
async function classify(url) {
  const img = await browserFetch(url).then(r => r.arrayBuffer());

  let promptText = PROMPT;
  if (RAG) {
    const vector = await embedViaSpace(img);
    const matches = await queryVectorize(vector);
    promptText = buildFewShotBlock(matches) + PROMPT;
  }

  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${MODEL}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{
        role: "user",
        content: [
          { type: "text", text: promptText },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${toBase64(img)}` } },
        ],
      }],
      max_tokens: 300,
      temperature: 0.2,
    }),
  }).then(r => r.json());

  if (!res.success) throw new Error(JSON.stringify(res.errors ?? res));
  return parseAnswer(res.result?.response);
}
```

- [ ] **Step 4: Note the mode in the summary line**

Replace:

```js
console.log(`${sample.length} covers, ${MODEL}\n`);
```

with:

```js
console.log(`${sample.length} covers, ${MODEL}${RAG ? " + RAG few-shot" : ""}\n`);
```

- [ ] **Step 5: Update the script's own header docstring**

Replace:

```js
 *   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... node scripts/eval-ai.mjs
 *   ... node scripts/eval-ai.mjs --n 80        # bigger sample
 *   ... node scripts/eval-ai.mjs --all         # every labelled cover, ~579 calls
```

with:

```js
 *   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... node scripts/eval-ai.mjs
 *   ... node scripts/eval-ai.mjs --n 80        # bigger sample
 *   ... node scripts/eval-ai.mjs --all         # every labelled cover, ~579 calls
 *   ... CLIP_SPACE_URL=... CLIP_SPACE_KEY=... node scripts/eval-ai.mjs --rag
 *       # scores the RAG-augmented prompt instead of the bare one — run both
 *       # ways on the same sample and compare agreement%. Needs a token with
 *       # Vectorize · Read on top of the Workers AI · Read above.
```

- [ ] **Step 6: Sanity-check the script still parses and runs its default (non-RAG) path**

```bash
node --check scripts/eval-ai.mjs
```

Expected: no output (syntax OK). A real `--rag` run needs the Space deployed and secrets set — that's Task 6, not this one.

- [ ] **Step 7: Commit**

```bash
git add scripts/eval-ai.mjs
git commit -m "eval-ai.mjs: add --rag flag to measure the few-shot classifier"
```

---

### Task 4: Docs — `dashboard/documentation/rag.md` and `image-embeddings.md`

**Files:**
- Modify: `dashboard/documentation/rag.md`
- Modify: `dashboard/documentation/image-embeddings.md`

**Interfaces:**
- Consumes: nothing (prose only). No code interface — do this task last, after Tasks 1–3 are committed, so it describes what's actually true.

- [ ] **Step 1: Rewrite `dashboard/documentation/rag.md`**

```markdown
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
```

- [ ] **Step 2: Update the "Nothing reads from the index yet" line in `dashboard/documentation/image-embeddings.md`**

Replace:

```
Nothing reads from the index yet. This is the embedding step only.
```

with:

```
[RAG](#rag) now reads from this index at classification time, once
`CLIP_SPACE_URL`/`CLIP_SPACE_KEY` are set — see that chapter for the
retrieval side.
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/documentation/rag.md dashboard/documentation/image-embeddings.md
git commit -m "Document the RAG few-shot classification pipeline"
```

---

### Task 5: Manual deploy & wiring (human-only — do not automate)

This task changes production secrets and a live third-party service. It is
not code, and it is not for a subagent to run unattended — Diogo runs these
himself.

**Files:** none (operational only).

- [ ] **Step 1: Create the Space**

On huggingface.co: New Space → name it (e.g. `capas-clip-embed`) → SDK:
**Docker** → create.

- [ ] **Step 2: Push `clip-space/` to it**

From the repo root, with the new Space's git URL from its "Files" tab:

```bash
git remote add clip-space https://huggingface.co/spaces/<your-username>/capas-clip-embed
git subtree push --prefix=clip-space clip-space main
```

- [ ] **Step 3: Set the Space secret**

In the Space's Settings → Repository secrets: add `SPACE_API_KEY` with a
generated random value (e.g. `openssl rand -hex 32`).

- [ ] **Step 4: Wait for the build, then check health**

```bash
curl https://<your-username>-capas-clip-embed.hf.space/
```

Expected: `{"status":"ok"}` (first build can take a few minutes — it's
installing `torch`).

- [ ] **Step 5: Measure — before wiring anything into production**

`scripts/eval-ai.mjs --rag` talks to the Space and to Vectorize directly
over REST — it does not go through the Worker, so this needs no
`wrangler secret` and no deploy yet. Deliberately in this order: a leak-free
number should decide whether the live path is worth turning on at all,
not the other way round. (Final review, 2026-08-27: the self-vote-leakage
fix landed in `buildFewShotBlock` before this step exists to run against —
if you're reading this plan fresh, confirm that fix is in place first.)

```bash
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... node scripts/eval-ai.mjs --n 80 > /tmp/baseline.txt
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... CLIP_SPACE_URL=https://<your-username>-capas-clip-embed.hf.space/embed CLIP_SPACE_KEY=... node scripts/eval-ai.mjs --n 80 --rag > /tmp/rag.txt
diff /tmp/baseline.txt /tmp/rag.txt
```

Compare the `agreement` line. This is what decides whether the few-shot
context is worth keeping — update `dashboard/documentation/rag.md`'s
Status section with the result either way. If the result doesn't justify
it, stop here — the Space can stay built-but-unwired, nothing downstream
depends on Steps 6-7.

- [ ] **Step 6: Wire the Worker's secrets**

Only once Step 5's number looks worth shipping:

```bash
wrangler secret put CLIP_SPACE_URL
# paste: https://<your-username>-capas-clip-embed.hf.space/embed

wrangler secret put CLIP_SPACE_KEY
# paste: the same value set as SPACE_API_KEY in step 3
```

- [ ] **Step 7: Deploy**

The index (`capas-cover-embeddings`) already exists — this just deploys the
Worker with the new `VECTORIZE` binding from Task 2:

```bash
wrangler deploy
```
