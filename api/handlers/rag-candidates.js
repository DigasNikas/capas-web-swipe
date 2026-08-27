import { json } from "../lib/http.js";

// GET /rag-candidates?limit=10 (admin, bearer-protected). Lists the most
// recently scraped covers with what scripts/rag_classify.py needs to embed
// and reclassify them: id (for the D1 write in /reclassify-rag) and r2_key
// (to fetch the full-res original, same as classifyAndStore does). Not the
// public /covers route: that one requires a Cf-Access user session and
// doesn't return r2_key, neither of which a GitHub Actions runner has.
//
// Deliberately "most recent N", not "everything missing a RAG pass" — the
// goal is keeping the AI Detector section fresh day to day, not clearing a
// historical backlog (there's no backfill mechanism for old covers anymore;
// removed for simplicity — see rag.md).
export async function handleRagCandidates(request, env) {
  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.ADMIN_SECRET}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 10, 50);

  const { results } = await env.DB
    .prepare("SELECT id, newspaper, date, r2_key, url FROM covers ORDER BY date DESC, newspaper ASC LIMIT ?")
    .bind(limit)
    .all();

  return json(results);
}
