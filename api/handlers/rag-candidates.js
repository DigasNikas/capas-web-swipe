import { json, parseLimit, requireAdmin } from "../lib/http.js";

// GET /rag-candidates?limit=10 (admin, bearer-protected). Lists covers still
// missing ai_club — newest first — with what scripts/rag_classify.py needs
// to embed and reclassify them: id (for the D1 write in /reclassify-rag),
// r2_key (to fetch the full-res original, same as classifyAndStore does),
// headlines (the text it embeds against capas-headline-embeddings) and date
// (so the text query can drop same-day siblings, which are the same story in
// near-identical words — see rag.md).
// Not the public /covers route: that one requires a Cf-Access user session
// and doesn't return r2_key, neither of which a GitHub Actions runner has.
//
// Self-converging on purpose: classifyAndStore always writes ai_club,
// ai_headline and ai_why together, so ai_club IS NULL alone is enough to
// mean "never classified" — no OR on the other two columns needed. Each
// successful /reclassify-rag call removes that cover from the next call's
// candidate set, so running this repeatedly (rag_classify.py's own loop, or
// by hand) works through the whole backlog instead of reprocessing the same
// top N forever.
export async function handleRagCandidates(request, env) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;

  // Default 10, hard cap 50: this is the one endpoint whose size directly
  // decides how many Llama4 calls a run makes, and rag.md's Quota section is
  // the record of what an unbounded one costs.
  const url = new URL(request.url);

  // needs=matches is the retrieval backlog rather than the classification one:
  // covers with no neighbours recorded, whatever their label. That pass costs
  // no Llama4 call, and it writes no label, so it needs a backlog that empties
  // as it works.
  const needs = url.searchParams.get("needs") ?? "label";
  if (needs !== "label" && needs !== "matches") return json({ error: "needs must be label or matches" }, 400);
  // A cover is not classifiable until its titles are stored. Without them the
  // prompt loses its titles block, retrieval runs on the image channel alone,
  // and no `others` gate score can be computed (see ai-detector.md) — and
  // nothing revisits a cover once ai_club is set. Past dates are exempt:
  // capasjornais.pt serves titles for today only, so waiting would mean never
  // classifying them. Retrieval-only runs write no label and need no titles.
  const pending = needs === "matches"
    ? "ai_rag_covers IS NULL"
    : "ai_club IS NULL AND (headlines IS NOT NULL OR date < date('now'))";

  // date= narrows to one cover day. Without it the backlog is newest-first,
  // so reaching a day a week back means classifying everything above it —
  // 27 Llama4 calls to look at 3 covers.
  const date = url.searchParams.get("date");
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "date must be YYYY-MM-DD" }, 400);
  const onDay = date ? "AND date = ?2" : "";

  // The cap on the classification backlog is what stands between a run and
  // the quota incident in rag.md, because every cover it returns is a Llama4
  // call. Retrieval makes none, so that backlog can be drained in far fewer
  // runs.
  const limit = parseLimit(url, 10, needs === "matches" ? 500 : 50);
  if (limit === null) return json({ error: "limit must be a positive integer" }, 400);

  const { results } = await env.DB
    .prepare(`SELECT id, newspaper, date, r2_key, url, headlines FROM covers WHERE ${pending} ${onDay} ORDER BY date DESC, newspaper ASC LIMIT ?1`)
    .bind(...(date ? [limit, date] : [limit]))
    .all();

  return json(results);
}
