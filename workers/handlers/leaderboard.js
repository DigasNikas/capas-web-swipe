import { json } from "../lib/http.js";

export async function handleLeaderboard(request, env) {
  const userEmail = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!userEmail) return json({ error: "Unauthorized" }, 401);

  const { results } = await env.DB
    .prepare("SELECT email, swipe_count FROM users ORDER BY swipe_count DESC")
    .all();

  const entries = results.map((r, i) => ({
    user_email: r.email,
    swipes:     r.swipe_count,
    rank:       i + 1,
    is_me:      r.email === userEmail,
  }));

  const inList = entries.some(e => e.is_me);
  if (!inList) {
    entries.push({ user_email: userEmail, swipes: 0, rank: entries.length + 1, is_me: true });
  }

  return json(entries);
}
