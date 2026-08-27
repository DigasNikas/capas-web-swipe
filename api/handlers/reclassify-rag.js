import { json } from "../lib/http.js";
import { classifyAndStore } from "../lib/ai.js";

// POST /reclassify-rag (admin, bearer-protected). Body: {coverId, r2Key,
// fewShot, ragCoverIds}. Classifies one cover with an externally-computed
// RAG few-shot block — the embedding and Vectorize retrieval that produced
// fewShot (and ragCoverIds, the cover_ids that retrieval matched) already
// happened in scripts/rag_classify.py, outside the Worker, because Workers
// AI has no CLIP model and no live embedding service is available (see
// rag.md for why). This endpoint only does what the Worker actually can:
// call Llama4 via classifyAndStore and write the result to D1. This is the
// only place a cover gets classified now — see ai-detector.md.
export async function handleReclassifyRag(request, env) {
  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.ADMIN_SECRET}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { coverId, r2Key, fewShot, ragCoverIds } = body;
  if (!coverId || !r2Key) {
    return json({ error: "coverId and r2Key required" }, 400);
  }

  const club = await classifyAndStore(env, coverId, r2Key, fewShot ?? "", ragCoverIds ?? []);
  return json({ coverId, club });
}
