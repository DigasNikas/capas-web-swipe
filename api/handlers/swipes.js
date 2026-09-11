import { json } from "../lib/http.js";
import { accessEmail } from "../lib/access.js";
import { dispatchGithubEvent } from "../lib/github.js";

// The app's four swipe directions (app/src/state.js). The winner of these
// becomes the public analytics_covers.club, and the dashboard looks each one
// up in its own club table, so anything else here breaks it for everyone.
const CLUBS = ["sporting", "benfica", "porto", "others"];

export async function handleGetSwipes(request, env) {
  const userEmail = await accessEmail(request, env);
  if (!userEmail) return json({ error: "Unauthorized" }, 401);

  const { results } = await env.DB
    .prepare("SELECT cover_id, decision, is_favorite, swiped_at FROM swipes WHERE user_email = ?")
    .bind(userEmail)
    .all();
  return json(results);
}

export async function handleToggleFavorite(request, env) {
  const userEmail = await accessEmail(request, env);
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

export async function handleSwipe(request, env, ctx) {
  const userEmail = await accessEmail(request, env);
  if (!userEmail) return json({ error: "Unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { cover_id, decision } = body;
  if (!cover_id || !decision) return json({ error: "Missing cover_id or decision" }, 400);
  if (!CLUBS.includes(decision)) return json({ error: "Unknown decision" }, 400);

  // One batch, which D1 commits as a single transaction: the first-vote
  // check, the vote, and the analytics recompute can't have another
  // request's writes land between them. Done as separate round-trips, a
  // request that read the totals before a concurrent vote could write them
  // back after it, and two simultaneous first votes both saw no row and
  // both fired the dispatch below.
  const [existing] = await env.DB.batch([
    env.DB.prepare("SELECT 1 FROM analytics_covers WHERE cover_id = ?").bind(cover_id),
    env.DB
      .prepare(`
        INSERT INTO swipes (user_email, cover_id, decision)
        VALUES (?, ?, ?)
        ON CONFLICT (user_email, cover_id)
        DO UPDATE SET decision = excluded.decision, swiped_at = datetime('now')
      `)
      .bind(userEmail, cover_id, decision),
    refreshAnalytics(env, cover_id),
  ]);

  // A cover only becomes embeddable once it has a crowd label (see
  // build_vectorize_index.py's CLUBS filter) — this is the moment that
  // becomes true, so it's the right trigger for a single-vector Vectorize
  // upsert instead of waiting for the weekly full re-embed.
  if (existing.results.length === 0) {
    ctx.waitUntil(dispatchGithubEvent(env, "cover-first-vote", { cover_id }));
  }

  return json({ ok: true });
}

// Keeps the public analytics_covers table (no user_email, safe to expose)
// in sync with the winning decision for one cover, right after it changes.
// The winner is the club with most votes, ties going to whichever was voted
// most recently. The count and the write are one statement, so the totals
// written are the totals at the moment of writing.
function refreshAnalytics(env, coverId) {
  return env.DB
    .prepare(`
      INSERT INTO analytics_covers (cover_id, newspaper, date, club, votes_club, votes_total, updated_at)
      SELECT c.id, c.newspaper, c.date, s.decision, COUNT(*),
             (SELECT COUNT(*) FROM swipes WHERE cover_id = c.id), datetime('now')
      FROM swipes s JOIN covers c ON c.id = s.cover_id
      WHERE s.cover_id = ?
      GROUP BY s.decision
      ORDER BY COUNT(*) DESC, MAX(s.swiped_at) DESC
      LIMIT 1
      ON CONFLICT (cover_id)
      DO UPDATE SET club = excluded.club, votes_club = excluded.votes_club,
        votes_total = excluded.votes_total, updated_at = excluded.updated_at
    `)
    .bind(coverId);
}
