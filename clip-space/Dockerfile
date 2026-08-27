FROM python:3.11-slim

# pip install runs as root, before the user switch below: python:3.11-slim's
# site-packages is root-owned, and a non-root `pip install` against it fails
# outright — this is the standard order every non-root Docker Python image
# uses (and what HF's own Spaces Docker template does) for that reason.
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt

# HF Spaces run containers as uid 1000 regardless of what the image declares,
# so root-owned files under $HOME (weights, cache) 403 at runtime unless the
# app actually runs as that same non-root user from here on.
RUN useradd -m -u 1000 user && chown -R user:user /app
USER user
ENV HOME=/home/user HF_HOME=/home/user/.cache/huggingface

RUN python -c "from transformers import CLIPModel, CLIPProcessor; CLIPModel.from_pretrained('openai/clip-vit-base-patch32'); CLIPProcessor.from_pretrained('openai/clip-vit-base-patch32')"

COPY --chown=user app.py .

EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
