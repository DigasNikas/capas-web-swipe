import { json, requireAdmin } from "../lib/http.js";
import { classifyAndStore } from "../lib/ai.js";

// POST /reclassify-rag (admin, bearer-protected). Body: {cover_id, r2_key,
// few_shot, rag_cover_ids}. Classifies one cover with an externally-computed
// RAG few-shot block — the embedding and Vectorize retrieval that produced
// fewShot (and ragCoverIds, the cover_ids that retrieval matched) already
// happened in scripts/rag_classify.py, outside the Worker, because Workers
// AI has no CLIP model and no live embedding service is available (see
// rag.md for why). This endpoint only does what the Worker actually can:
// call Llama4 via classifyAndStore and write the result to D1. This is the
// only place a cover gets classified now — see ai-detector.md.
export async function handleReclassifyRag(request, env) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { cover_id, r2_key, few_shot, rag_cover_ids } = body;
  if (!cover_id || !r2_key) {
    return json({ error: "cover_id and r2_key required" }, 400);
  }

  const club = await classifyAndStore(env, cover_id, r2_key, few_shot ?? "", rag_cover_ids ?? []);
  return json({ ok: true, cover_id, club });
}
