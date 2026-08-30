import { json } from "../lib/http.js";

// GET /headline-candidates?limit= (admin, bearer-protected). Every cover
// still missing `headlines`, oldest first — the order scripts/backfill_
// headlines_archive.mjs wants, since it caches one capasjornais.pt archive
// page per (newspaper, year-month) and going chronologically keeps hits on
// that cache together instead of scattering them across the whole range.
// Self-converging like /rag-candidates and /vectorize-candidates: each
// successful /update-headline call removes that cover from the next call's
// set.
export async function handleHeadlineCandidates(request, env) {
  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.ADMIN_SECRET}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 500, 2000);

  const { results } = await env.DB
    .prepare("SELECT id, newspaper, date FROM covers WHERE headlines IS NULL ORDER BY date ASC LIMIT ?")
    .bind(limit)
    .all();

  return json(results);
}
