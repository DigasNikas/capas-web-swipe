import { json } from "../lib/http.js";

// GET /similarities (public). Every cover that has ai_rag_covers recorded,
// plus the covers those ids actually resolve to, so the RAG few-shot
// matches can be eyeballed against the cover they were used on: is the
// retrieval finding genuinely similar covers, or just same-newspaper
// layout matches (the exact weak-prior worry documented in
// image-embeddings.md and rag.md)? Not restricted to voted covers like
// /api/stats, an unclassified cover's RAG matches are exactly what's most
// useful to check right after rag-classify.yml runs, before anyone's voted.
// No auth: same reasoning as /documentation, this is internal-interest
// data (AI guesses, retrieval matches) with no user attached to it, not a
// secret.
export async function handleSimilarities(env) {
  // Diagnostic-only try/catch: this endpoint exists purely for debugging
  // RAG retrieval quality, so a plain D1 error message back to the caller
  // is more useful here than the bare 500 a thrown error would otherwise
  // produce. console.error also puts it in the Worker's real-time logs
  // (observability.logs is on, see wrangler.toml).
  try {
    const { results: rows } = await env.DB
      .prepare(`
        SELECT id, newspaper, date, url, thumb_url, ai_club, ai_headline, ai_rag_covers
        FROM covers
        WHERE ai_rag_covers IS NOT NULL AND ai_rag_covers != '[]'
        ORDER BY date DESC
      `)
      .all();

    // ai_rag_covers is a JSON array of cover_id strings (see ai.js's
    // ragCoverIdsFromMatches). Parse each row's once, and collect every id
    // referenced anywhere so the covers they point to can be fetched in one
    // second query instead of one per row.
    const parsed = rows.map(r => {
      let ids = [];
      try { ids = JSON.parse(r.ai_rag_covers); } catch { /* malformed, treat as none */ }
      return { ...r, ragIds: ids.map(Number).filter(Number.isInteger) };
    }).filter(r => r.ragIds.length > 0);

    const allIds = [...new Set(parsed.flatMap(r => r.ragIds))];
    const refById = new Map();
    if (allIds.length > 0) {
      const placeholders = allIds.map(() => "?").join(",");
      const { results: refs } = await env.DB
        .prepare(`
          SELECT c.id, c.newspaper, c.date, c.url, c.thumb_url, c.ai_club, ac.club
          FROM covers c
          LEFT JOIN analytics_covers ac ON ac.cover_id = c.id
          WHERE c.id IN (${placeholders})
        `)
        .bind(...allIds)
        .all();
      refs.forEach(r => refById.set(r.id, r));
    }

    const result = parsed.map(({ ragIds, ai_rag_covers, ...cover }) => ({
      ...cover,
      ragCovers: ragIds.map(id => refById.get(id)).filter(Boolean),
    }));

    return json(result);
  } catch (err) {
    console.error(`GET /similarities failed: ${err}`);
    return json({ error: String(err?.message ?? err) }, 500);
  }
}
