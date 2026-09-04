import { json, requireAdmin } from "../lib/http.js";

// POST /vectorize-mark (admin, bearer-protected). Body: {coverIds: [...]}.
// Sets vectorized_at = now for each id, so /vectorize-candidates stops
// returning them. Called by scripts/build_vectorize_index.py right after
// a batch upserts successfully into Vectorize, never before — a batch
// that fails to upsert should stay in the backlog for the next run, not
// get marked done and silently dropped.
export async function handleVectorizeMark(request, env) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { cover_ids } = body;
  if (!Array.isArray(cover_ids) || cover_ids.length === 0) {
    return json({ error: "cover_ids required" }, 400);
  }

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
        .prepare(`UPDATE covers SET vectorized_at = datetime('now') WHERE id IN (${placeholders})`)
        .bind(...batch)
        .run();
    }
    return json({ ok: true, marked: cover_ids.length });
  } catch (err) {
    console.error(`POST /vectorize-mark failed: ${err}`);
    return json({ error: String(err?.message ?? err) }, 500);
  }
}
