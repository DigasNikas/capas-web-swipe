import { json } from "../lib/http.js";

export async function handleCovers(request, env) {
  const userEmail = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!userEmail) return json({ error: "Unauthorized" }, 401);

  const { results } = await env.DB
    .prepare("SELECT id, newspaper, date, url FROM covers ORDER BY date DESC, newspaper ASC")
    .all();
  return json(results);
}
