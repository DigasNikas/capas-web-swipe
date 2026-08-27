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
