import { json } from "../lib/http.js";

const CLUBS = ["sporting", "benfica", "porto", "others"];
const PAPER_NAMES = { abola: "A Bola", ojogo: "O Jogo", record: "Record" };

// Public — reads only analytics_covers (+ covers for image URLs), never swipes.
// Returns raw per-cover rows; the landing page aggregates them (by época,
// by paper, by day) client-side so filtering doesn't need another round trip.
export async function handleStats(env) {
  const { results: rows } = await env.DB
    .prepare("SELECT cover_id, newspaper, date, club, votes_club, votes_total FROM analytics_covers ORDER BY date ASC")
    .all();

  let latest = null;
  if (rows.length > 0) {
    const latestDate = rows[rows.length - 1].date;
    const latestRows = rows.filter(r => r.date === latestDate);
    const { results: urlRows } = await env.DB
      .prepare(`SELECT id, url FROM covers WHERE id IN (${latestRows.map(() => "?").join(",")})`)
      .bind(...latestRows.map(r => r.cover_id))
      .all();
    const urlByCover = Object.fromEntries(urlRows.map(u => [u.id, u.url]));
    const tally = Object.fromEntries(CLUBS.map(c => [c, 0]));
    latestRows.forEach(r => tally[r.club]++);
    const winner = CLUBS.reduce((a, b) => (tally[b] > tally[a] ? b : a), CLUBS[0]);
    latest = {
      date: latestDate,
      winner,
      confidence: tally[winner] / latestRows.length,
      covers: latestRows.map(r => ({
        newspaper: r.newspaper,
        name: PAPER_NAMES[r.newspaper],
        club: r.club,
        votes_club: r.votes_club,
        votes_total: r.votes_total,
        url: urlByCover[r.cover_id],
      })),
    };
  }

  return json({ rows, latest });
}
