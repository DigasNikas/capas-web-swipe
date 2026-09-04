import { json, parseLimit, requireAdmin } from "../lib/http.js";

// GET /headline-candidates?limit= (admin, bearer-protected). Every cover
// still missing `headlines`, oldest first — the order scripts/backfill_
// headlines_archive.mjs wants, since it caches one capasjornais.pt archive
// page per (newspaper, year-month) and going chronologically keeps hits on
// that cache together instead of scattering them across the whole range.
// Self-converging like /rag-candidates and /vectorize-candidates: each
// successful /update-headline call removes that cover from the next call's
// set.
export async function handleHeadlineCandidates(request, env) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;

  // Bigger than /rag-candidates because the work per row is one polite HTTP
  // fetch on the caller's side, not a model call — the whole remaining gap is
  // a few hundred covers, so one run should be able to ask for all of it.
  const limit = parseLimit(new URL(request.url), 500, 2000);
  if (limit === null) return json({ error: "limit must be a positive integer" }, 400);

  const { results } = await env.DB
    .prepare("SELECT id, newspaper, date FROM covers WHERE headlines IS NULL ORDER BY date ASC LIMIT ?")
    .bind(limit)
    .all();

  return json(results);
}
