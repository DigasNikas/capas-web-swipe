import { json } from "../lib/http.js";

// Called from the leaderboard's per-row drill-down (app/src/leaderboard.js).
// Access-gated like every other app-side handler, but not scoped to the
// requester's own email — any authenticated app user can look up any other
// user's stats, same exposure the leaderboard list already has (names +
// counts are visible to the whole group there too).
export async function handleUserStats(request, env, url) {
  const requester = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!requester) return json({ error: "Unauthorized" }, 401);

  const email = url.searchParams.get("email");
  if (!email) return json({ error: "Missing email" }, 400);

  const { results: breakdown } = await env.DB
    .prepare("SELECT decision, COUNT(*) AS count FROM swipes WHERE user_email = ? GROUP BY decision")
    .bind(email)
    .all();

  // One row per archive day, voted_covers vs total_covers — "completed" for
  // this user only once every cover published that day has a swipe, same
  // rule the app calendar's own green checkmark uses client-side.
  const { results: days } = await env.DB.prepare(`
    SELECT c.date,
           COUNT(*) AS total_covers,
           COUNT(s.id) AS voted_covers
    FROM covers c
    LEFT JOIN swipes s ON s.cover_id = c.id AND s.user_email = ?
    GROUP BY c.date
    ORDER BY c.date ASC
  `).bind(email).all();

  let best_streak = 0, run = 0;
  for (const d of days) {
    if (d.voted_covers >= d.total_covers) { run++; best_streak = Math.max(best_streak, run); }
    else run = 0;
  }

  // Current streak walks backward from the most recent day. If that latest
  // day isn't finished yet, that's "hasn't gotten to it", not a break — skip
  // it and start counting from the most recent *completed* day instead.
  let current_streak = 0;
  let i = days.length - 1;
  if (i >= 0 && days[i].voted_covers < days[i].total_covers) i--;
  for (; i >= 0 && days[i].voted_covers >= days[i].total_covers; i--) current_streak++;

  return json({
    email,
    breakdown: Object.fromEntries(breakdown.map(r => [r.decision, r.count])),
    current_streak,
    best_streak,
  });
}
