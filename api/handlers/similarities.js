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
        SELECT id, newspaper, date, url, thumb_url, ai_club, ai_headline, ai_rag_covers, ai_rag_source
        FROM covers
        WHERE ai_rag_covers IS NOT NULL AND ai_rag_covers != '[]'
        ORDER BY date DESC
      `)
      .all();

    // ai_rag_covers is a JSON array of cover_id strings (see ai.js's
    // ragCoverIdsFromMatches), and ai_rag_source the channel that found each
    // one, same order (ragSourcesFromMatches). Parse each row's once, and
    // collect every id referenced anywhere so the covers they point to can be
    // fetched in one second query instead of one per row.
    const parsed = rows.map(r => {
      // JSON.parse(null) is null rather than a throw, so the catch alone
      // does not make these arrays — a row with no ai_rag_source has to
      // survive as an empty list, not as null being indexed.
      const asArray = raw => {
        try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; }
        catch { return []; }
      };
      const ragIds = asArray(r.ai_rag_covers).map(Number).filter(Number.isInteger);
      const sources = asArray(r.ai_rag_source);
      // Positional pairing, so a row written before ai_rag_source existed —
      // or one whose two columns somehow disagree in length — reads as
      // layout, the only channel there was when that could have happened.
      return { ...r, ragIds, ragVia: ragIds.map((_, i) => sources[i] ?? "layout") };
    }).filter(r => r.ragIds.length > 0);

    const allIds = [...new Set(parsed.flatMap(r => r.ragIds))];
    const refById = new Map();
    // D1 rejects a query with too many bound parameters ("too many SQL
    // variables") well before SQLite's own 999 default, so a single IN (...)
    // over every referenced id breaks once the backlog grows past a
    // couple dozen rows (RAG_TOP_K is 7, so it doesn't take many rows to
    // get there). Batching keeps this working regardless of how large
    // ai_rag_covers's backlog gets.
    const BATCH = 100;
    for (let i = 0; i < allIds.length; i += BATCH) {
      const batch = allIds.slice(i, i + BATCH);
      const placeholders = batch.map(() => "?").join(",");
      const { results: refs } = await env.DB
        .prepare(`
          SELECT c.id, c.newspaper, c.date, c.url, c.thumb_url, c.ai_club, ac.club
          FROM covers c
          LEFT JOIN analytics_covers ac ON ac.cover_id = c.id
          WHERE c.id IN (${placeholders})
        `)
        .bind(...batch)
        .all();
      refs.forEach(r => refById.set(r.id, r));
    }

    const result = parsed.map(({ ragIds, ragVia, ai_rag_covers, ai_rag_source, ...cover }) => ({
      ...cover,
      ragCovers: ragIds
        .map((id, i) => {
          const ref = refById.get(id);
          return ref && { ...ref, via: ragVia[i] };
        })
        .filter(Boolean),
    }));

    return json(result);
  } catch (err) {
    console.error(`GET /similarities failed: ${err}`);
    return json({ error: String(err?.message ?? err) }, 500);
  }
}
