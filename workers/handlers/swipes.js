import { json } from "../lib/http.js";

export async function handleGetSwipes(request, env) {
  const userEmail = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!userEmail) return json({ error: "Unauthorized" }, 401);

  const { results } = await env.DB
    .prepare("SELECT cover_id, decision, swiped_at FROM swipes WHERE user_email = ?")
    .bind(userEmail)
    .all();
  return json(results);
}

export async function handleSwipe(request, env) {
  const userEmail = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!userEmail) return json({ error: "Unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { cover_id, decision } = body;
  if (!cover_id || !decision) return json({ error: "Missing cover_id or decision" }, 400);

  await env.DB
    .prepare(`
      INSERT INTO swipes (user_email, cover_id, decision)
      VALUES (?, ?, ?)
      ON CONFLICT (user_email, cover_id)
      DO UPDATE SET decision = excluded.decision, swiped_at = datetime('now')
    `)
    .bind(userEmail, cover_id, decision)
    .run();

  return json({ ok: true });
}
