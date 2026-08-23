import { json } from "../lib/http.js";

export async function handleGetSwipes(request, env) {
  const userEmail = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!userEmail) return json({ error: "Unauthorized" }, 401);

  const { results } = await env.DB
    .prepare("SELECT cover_id, decision, is_favorite, swiped_at FROM swipes WHERE user_email = ?")
    .bind(userEmail)
    .all();
  return json(results);
}

export async function handleToggleFavorite(request, env) {
  const userEmail = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!userEmail) return json({ error: "Unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { cover_id, favorite } = body;
  if (!cover_id || typeof favorite !== "boolean") return json({ error: "Missing cover_id or favorite" }, 400);

  await env.DB
    .prepare("UPDATE swipes SET is_favorite = ? WHERE user_email = ? AND cover_id = ?")
    .bind(favorite ? 1 : 0, userEmail, cover_id)
    .run();

  return json({ ok: true });
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

  await refreshAnalytics(env, cover_id);

  return json({ ok: true });
}

// Keeps the public analytics_covers table (no user_email, safe to expose)
// in sync with the winning decision for one cover, right after it changes.
async function refreshAnalytics(env, coverId) {
  const { results } = await env.DB
    .prepare(`
      SELECT c.newspaper, c.date, s.decision, COUNT(*) as votes, MAX(s.swiped_at) as last_at
      FROM swipes s JOIN covers c ON c.id = s.cover_id
      WHERE s.cover_id = ?
      GROUP BY s.decision, c.newspaper, c.date
    `)
    .bind(coverId)
    .all();
  if (results.length === 0) return;

  const votesTotal = results.reduce((sum, r) => sum + r.votes, 0);
  const winner = results.sort((a, b) => b.votes - a.votes || b.last_at.localeCompare(a.last_at))[0];

  await env.DB
    .prepare(`
      INSERT INTO analytics_covers (cover_id, newspaper, date, club, votes_club, votes_total, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT (cover_id)
      DO UPDATE SET club = excluded.club, votes_club = excluded.votes_club,
        votes_total = excluded.votes_total, updated_at = excluded.updated_at
    `)
    .bind(coverId, winner.newspaper, winner.date, winner.decision, winner.votes, votesTotal)
    .run();
}
