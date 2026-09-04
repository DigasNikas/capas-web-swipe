import { json, requireAdmin } from "../lib/http.js";
import { resolveIndex } from "../lib/vectorize.js";

// POST /vectorize-mark (admin, bearer-protected). Body: {cover_ids: [...],
// index?}. Sets that index's progress column to now for each id
// (vectorized_at for image, the default; headline_vectorized_at for
// headline — see lib/vectorize.js), so /vectorize-candidates stops
// returning them. Called by scripts/build_vectorize_index.py right after
// a batch upserts successfully into Vectorize, never before — a batch
// that fails to upsert should stay in the backlog for the next run, not
// get marked done and silently dropped.
export async function handleVectorizeMark(request, env) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { cover_ids, index: indexName } = body;
  if (!Array.isArray(cover_ids) || cover_ids.length === 0) {
    return json({ error: "cover_ids required" }, 400);
  }

  const index = resolveIndex(indexName);
  if (!index) return json({ error: "index must be image or headline" }, 400);

  try {
    // Batched the same way similarities.js's resolve query is: D1 rejects
    // a query with too many bound parameters well before this array could
    // plausibly get that large, but there's no reason to trust that "it
    // won't happen here" a second time.
    const BATCH = 100;
    for (let i = 0; i < cover_ids.length; i += BATCH) {
      const batch = cover_ids.slice(i, i + BATCH);
      const placeholders = batch.map(() => "?").join(",");
      await env.DB
        .prepare(`UPDATE covers SET ${index.column} = datetime('now') WHERE id IN (${placeholders})`)
        .bind(...batch)
        .run();
    }
    return json({ ok: true, marked: cover_ids.length });
  } catch (err) {
    console.error(`POST /vectorize-mark failed: ${err}`);
    return json({ error: String(err?.message ?? err) }, 500);
  }
}
