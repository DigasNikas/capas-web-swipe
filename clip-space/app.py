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
    """CLIP's image projection, L2-normalized. get_image_features() returns
    the projected (1, 512) embedding; this is the pooled output."""
    inputs = processor(images=image, return_tensors="pt")
    with torch.no_grad():
        out = model.get_image_features(**inputs)
    vec = out[0].numpy()
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
