import { json } from "../lib/http.js";

// GET /headlines (public, no auth — same reasoning as /search and
// /similarities: scraped front-page text with no user attached to it, and
// /search already returns it a page at a time).
//
// Exists for scripts/rag_classify.py --eval, which scores the prompt the
// Worker actually sends and therefore needs the same covers.headlines text
// classifyAndStore reads from D1. That script has no D1 credentials, only
// public HTTP.
//
// Its own route rather than a flag on /stats: /stats is aggregate results
// derived from analytics_covers, and raw headline text is neither aggregate
// nor from that table. Bolting it on there also meant the dashboard, which
// fetches every /stats row on load and reads none of this, paying for it —
// 587 KB to 1.5 MB across the current archive.
export async function handleHeadlines(env) {
  const { results } = await env.DB
    .prepare("SELECT id, headlines FROM covers WHERE headlines IS NOT NULL")
    .all();

  return json(results);
}
