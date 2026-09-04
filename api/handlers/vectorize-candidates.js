import { json, parseLimit, requireAdmin } from "../lib/http.js";
import { resolveIndex } from "../lib/vectorize.js";

// GET /vectorize-candidates?limit=&index= (admin, bearer-protected). Every
// voted cover not yet embedded into the named index, newest first, for
// scripts/build_vectorize_index.py's --candidates mode to embed in one
// batch instead of one GitHub Actions run per cover. Mirrors
// /rag-candidates exactly: self-converging (each successful
// /vectorize-mark call removes those covers from the next call's set), so
// a burst of cover-first-vote dispatches all racing for the same backlog
// only does real work once — see vectorize-mark.js and
// dashboard/documentation/image-embeddings.md.
//
// index= picks which of the two (see lib/vectorize.js): image, the default,
// for cover images, or headline for the lead-headline text index. Same query
// either way apart from the progress column and the field the caller needs
// back to embed — scripts/build_headline_index.py is the headline caller.
//
// The progress column is the source of truth here, not "does analytics_covers
// have a row" (what handleSwipe's own first-vote check still uses to
// decide whether to dispatch at all): a cover can have a vote and still
// not be embedded yet, and that gap is exactly what this query exists to
// find.
export async function handleVectorizeCandidates(request, env) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;

  const url = new URL(request.url);
  const index = resolveIndex(url.searchParams.get("index"));
  if (!index) return json({ error: "index must be image or headline" }, 400);

  // Default and cap are the same number on purpose: it matches
  // build_vectorize_index.py's BATCH, one Vectorize upsert per run.
  const limit = parseLimit(url, 500, 500);
  if (limit === null) return json({ error: "limit must be a positive integer" }, 400);

  const { results } = await env.DB
    .prepare(`
      SELECT ${index.fields}
      FROM covers c
      JOIN analytics_covers ac ON ac.cover_id = c.id
      WHERE c.${index.column} IS NULL ${index.where}
      ORDER BY c.date DESC
      LIMIT ?
    `)
    .bind(limit)
    .all();

  return json(results);
}
