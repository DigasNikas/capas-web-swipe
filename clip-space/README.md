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
