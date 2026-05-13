import { json } from "../lib/http.js";

export async function handleLeaderboard(request, env) {
  const userEmail = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!userEmail) return json({ error: "Unauthorized" }, 401);

  const { results } = await env.DB
    .prepare("SELECT user_email, COUNT(*) as swipes FROM swipes GROUP BY user_email ORDER BY swipes DESC")
    .all();

  const entries = results.map((r, i) => ({
    user_email: r.user_email,
    swipes: r.swipes,
    rank: i + 1,
    is_me: r.user_email === userEmail,
  }));

  const inList = entries.some(e => e.is_me);
  if (!inList) {
    entries.push({ user_email: userEmail, swipes: 0, rank: entries.length + 1, is_me: true });
  }

  return json(entries);
}
