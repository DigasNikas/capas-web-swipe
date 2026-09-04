import { json, parseLimit, requireAdmin } from "../lib/http.js";

// GET /vectorize-candidates?limit= (admin, bearer-protected). Every voted
// cover not yet embedded into capas-cover-embeddings, newest first, for
// scripts/build_vectorize_index.py's --candidates mode to embed in one
// batch instead of one GitHub Actions run per cover. Mirrors
// /rag-candidates exactly: self-converging (each successful
// /vectorize-mark call removes those covers from the next call's set), so
// a burst of cover-first-vote dispatches all racing for the same backlog
// only does real work once — see vectorize-mark.js and
// dashboard/documentation/image-embeddings.md.
//
// vectorized_at is the source of truth here, not "does analytics_covers
// have a row" (what handleSwipe's own first-vote check still uses to
// decide whether to dispatch at all): a cover can have a vote and still
// not be embedded yet, and that gap is exactly what this query exists to
// find.
export async function handleVectorizeCandidates(request, env) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;

  // Default and cap are the same number on purpose: it matches
  // build_vectorize_index.py's BATCH, one Vectorize upsert per run.
  const limit = parseLimit(new URL(request.url), 500, 500);
  if (limit === null) return json({ error: "limit must be a positive integer" }, 400);

  const { results } = await env.DB
    .prepare(`
      SELECT c.id, c.newspaper, c.date, c.url, ac.club
      FROM covers c
      JOIN analytics_covers ac ON ac.cover_id = c.id
      WHERE c.vectorized_at IS NULL
      ORDER BY c.date DESC
      LIMIT ?
    `)
    .bind(limit)
    .all();

  return json(results);
}
