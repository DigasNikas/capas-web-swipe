import { json } from "../lib/http.js";

export async function handleCovers(env) {
  const { results } = await env.DB
    .prepare("SELECT id, newspaper, date, url FROM covers ORDER BY date DESC, newspaper ASC")
    .all();
  return json(results);
}
