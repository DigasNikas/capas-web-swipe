import { json, parseLimit, requireAdmin } from "../lib/http.js";

// GET /rag-candidates?limit=10 (admin, bearer-protected). Lists covers still
// missing ai_club — newest first — with what scripts/rag_classify.py needs
// to embed and reclassify them: id (for the D1 write in /reclassify-rag) and
// r2_key (to fetch the full-res original, same as classifyAndStore does).
// Not the public /covers route: that one requires a Cf-Access user session
// and doesn't return r2_key, neither of which a GitHub Actions runner has.
//
// Self-converging on purpose: classifyAndStore always writes ai_club,
// ai_headline and ai_why together, so ai_club IS NULL alone is enough to
// mean "never classified" — no OR on the other two columns needed. Each
// successful /reclassify-rag call removes that cover from the next call's
// candidate set, so running this repeatedly (rag_classify.py's own loop, or
// by hand) works through the whole backlog instead of reprocessing the same
// top N forever.
export async function handleRagCandidates(request, env) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;

  // Default 10, hard cap 50: this is the one endpoint whose size directly
  // decides how many Llama4 calls a run makes, and rag.md's Quota section is
  // the record of what an unbounded one costs.
  const limit = parseLimit(new URL(request.url), 10, 50);
  if (limit === null) return json({ error: "limit must be a positive integer" }, 400);

  const { results } = await env.DB
    .prepare("SELECT id, newspaper, date, r2_key, url FROM covers WHERE ai_club IS NULL ORDER BY date DESC, newspaper ASC LIMIT ?")
    .bind(limit)
    .all();

  return json(results);
}
