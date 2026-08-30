import { json } from "../lib/http.js";

// POST /update-headline (admin, bearer-protected). Body: {id, headlines}.
// Single-cover write, called once per cover by scripts/backfill_headlines_
// archive.mjs right after it successfully extracts that cover's headline
// text from its capasjornais.pt dated permalink page — not batched like
// /vectorize-mark, since the crawl itself (one page fetch per cover) is
// the bottleneck here, not the D1 write, and a single-item call means a
// crash partway through the crawl loses no already-fetched progress.
export async function handleUpdateHeadline(request, env) {
  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.ADMIN_SECRET}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { id, headlines } = body;
  if (!id) return json({ error: "id required" }, 400);
  if (!headlines) return json({ error: "headlines required" }, 400);

  await env.DB
    .prepare("UPDATE covers SET headlines = ? WHERE id = ?")
    .bind(headlines, id)
    .run();

  return json({ success: true, id });
}
