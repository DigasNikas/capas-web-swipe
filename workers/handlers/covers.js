import { json } from "../lib/http.js";

export async function handleCovers(request, env) {
  const url = new URL(request.url);
  let since = url.searchParams.get("since");

  if (!since) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 30);
    since = d.toISOString().slice(0, 10);
  }

  const { results } = await env.DB
    .prepare("SELECT id, newspaper, date, url FROM covers WHERE date >= ? ORDER BY date DESC, newspaper ASC")
    .bind(since)
    .all();
  return json(results);
}
