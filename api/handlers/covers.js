import { json } from "../lib/http.js";
import { accessEmail } from "../lib/access.js";

export async function handleCovers(request, env) {
  const userEmail = await accessEmail(request, env);
  if (!userEmail) return json({ error: "Unauthorized" }, 401);

  const { results } = await env.DB
    .prepare("SELECT id, newspaper, date, url, COALESCE(thumb_url, url) AS thumb_url FROM covers ORDER BY date DESC, newspaper ASC")
    .all();
  return json(results);
}
