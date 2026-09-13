import { json, requireAdmin } from "../lib/http.js";
import { NEWSPAPERS, fetchHeadlines } from "../lib/scraper.js";

// Refreshes `headlines` for today's covers from capasjornais.pt.
//
// The scrape cron runs at 05:00 UTC, before that page turns over to the new
// edition, so scrapeNewspaper's own attempt usually finds yesterday's paper
// and now stores nothing (see scraper.js's headlinesIfFresh). This is the
// second pass that picks the text up once the page catches up, and it
// rewrites rows that already have text rather than only filling nulls: the
// archive is full of covers holding the previous edition's headlines.
//
// Today-only: capasjornais.pt has no per-date page, so a past cover has no
// source to read from here.
//
//   curl -X POST -H "Authorization: Bearer <ADMIN_SECRET>" \
//     https://capas.digasnikas.com/api/backfill-headlines
export async function handleBackfillHeadlines(request, env) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;

  return json(await refreshTodayHeadlines(env));
}

// Same work, callable from the cron in index.js.
export async function refreshTodayHeadlines(env) {
  const today = new Date().toISOString().slice(0, 10);
  const { results: rows } = await env.DB
    .prepare("SELECT id, newspaper FROM covers WHERE date = ?")
    .bind(today)
    .all();

  let done = 0;
  for (const row of rows) {
    const newspaper = NEWSPAPERS.find(n => n.slug === row.newspaper);
    const headlines = newspaper && await fetchHeadlines(newspaper, today);
    if (!headlines) continue;

    await env.DB
      .prepare("UPDATE covers SET headlines = ? WHERE id = ?")
      .bind(headlines, row.id)
      .run();
    done++;
  }

  console.log(`Headlines refreshed for ${done} of ${rows.length} covers dated ${today}`);
  return { ok: true, done, checked: rows.length };
}
