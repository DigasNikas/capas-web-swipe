import { json } from "../lib/http.js";

// FTS5 special syntax characters (", *, :, -, (, ), etc.) let a typed
// sentence accidentally become a query operator instead of text to search
// for. Quoting each term makes it a literal phrase match, space-separated
// terms AND together by default. Capped at 12 terms — a search box, not a
// paragraph — and returns "" for an empty/whitespace-only query, which
// handleSearch treats as "no search," never as a MATCH '' (invalid FTS5
// syntax, not just zero results).
export function buildFtsQuery(q) {
  const terms = q.trim().split(/\s+/).filter(Boolean).slice(0, 12);
  return terms.map(t => `"${t.replace(/"/g, '""')}"`).join(" ");
}

// GET /search?q= (public, no auth — same reasoning as /similarities: AI
// guesses and headline text, nothing user-attached). Always reports
// {total, searchable} alongside results, even for an empty q, so the UI
// can show "text search covers X of Y front pages" without a second
// request: headlines only exists from a cover's scrape day forward or
// where the historical backfill reached, see dashboard/documentation/
// headlines.md, so `searchable` is well short of `total` and that gap
// isn't going away.
export async function handleSearch(request, env, url) {
  const { results: [{ total, searchable }] } = await env.DB
    .prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN headlines IS NOT NULL THEN 1 ELSE 0 END) AS searchable FROM covers")
    .all();

  const q = (url.searchParams.get("q") ?? "").trim();
  const ftsQuery = buildFtsQuery(q);
  if (!ftsQuery) return json({ results: [], total, searchable });

  const { results } = await env.DB
    .prepare(`
      SELECT c.id, c.newspaper, c.date, c.url, c.thumb_url, c.headlines, bm25(covers_fts) AS rank
      FROM covers_fts
      JOIN covers c ON c.id = covers_fts.rowid
      WHERE covers_fts MATCH ?
      ORDER BY rank
      LIMIT 30
    `)
    .bind(ftsQuery)
    .all();

  return json({ results, total, searchable });
}
