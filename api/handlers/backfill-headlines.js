import { NEWSPAPERS, fetchHeadlines } from "../lib/scraper.js";

// One-off: fills in `headlines` for covers scraped earlier today, before
// this feature was deployed (see scraper.js — scrapeNewspaper only sets
// headlines at insert time, so a row that already existed is never
// touched). Today-only, not a general historical backfill: capasjornais.pt
// has no per-date page for headlines, only "today's edition", so a cover
// from a past date has no source to backfill from here.
//
//   curl -X POST -H "Authorization: Bearer <ADMIN_SECRET>" \
//     https://capas.digasnikas.com/api/backfill-headlines
export async function handleBackfillHeadlines(request, env) {
  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.ADMIN_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const { results: rows } = await env.DB
    .prepare("SELECT id, newspaper FROM covers WHERE headlines IS NULL AND date = ?")
    .bind(today)
    .all();

  let done = 0;
  for (const row of rows) {
    const newspaper = NEWSPAPERS.find(n => n.slug === row.newspaper);
    const headlines = newspaper && await fetchHeadlines(newspaper);
    if (!headlines) continue;

    await env.DB
      .prepare("UPDATE covers SET headlines = ? WHERE id = ?")
      .bind(headlines, row.id)
      .run();
    done++;
  }

  return new Response(JSON.stringify({ done, checked: rows.length }), {
    headers: { "Content-Type": "application/json" },
  });
}
