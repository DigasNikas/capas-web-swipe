import { json, requireAdmin } from "../lib/http.js";

// POST /rag-matches (admin, bearer-protected). Body: {cover_id,
// rag_cover_ids, rag_sources}. Records which covers retrieval matched, and
// through which channel, without classifying anything.
//
// Retrieval is CLIP, MiniLM and two Vectorize queries — all outside the
// Worker, none of it Workers AI — so it can run when the daily neuron
// allowance is gone, which is the whole reason this exists separately from
// /reclassify-rag. It feeds the Parecidas page, which reads ai_rag_covers.
//
// ai_club is deliberately left alone: a cover whose neighbours are known but
// whose page nobody has read yet is still waiting for a label.
export async function handleRagMatches(request, env) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { cover_id, rag_cover_ids, rag_sources } = body;
  if (!cover_id || !Array.isArray(rag_cover_ids)) {
    return json({ error: "cover_id and rag_cover_ids required" }, 400);
  }

  await env.DB
    .prepare("UPDATE covers SET ai_rag_covers = ?, ai_rag_source = ? WHERE id = ?")
    .bind(JSON.stringify(rag_cover_ids), JSON.stringify(rag_sources ?? []), cover_id)
    .run();

  return json({ ok: true, cover_id, matches: rag_cover_ids.length });
}
