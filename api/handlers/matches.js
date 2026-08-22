import { json } from "../lib/http.js";

export async function handleGetMatches(env) {
  const { results } = await env.DB
    .prepare("SELECT club, match_date FROM matches ORDER BY match_date")
    .all();
  return json(results);
}
