import { json } from "../lib/http.js";

const CLUBS = ["sporting", "benfica", "porto", "others"];
const PAPER_NAMES = { abola: "A Bola", ojogo: "O Jogo", record: "Record" };

// Public — reads only analytics_covers (+ covers for image URLs), never swipes.
// Returns raw per-cover rows; the landing page aggregates them (by época,
// by paper, by day) client-side so filtering doesn't need another round trip.
export async function handleStats(env) {
  const { results: rows } = await env.DB
    .prepare(`
      SELECT ac.cover_id, ac.newspaper, ac.date, ac.club, ac.votes_club, ac.votes_total,
             c.url, COALESCE(c.thumb_url, c.url) AS thumb_url
      FROM analytics_covers ac
      JOIN covers c ON c.id = ac.cover_id
      ORDER BY ac.date ASC
    `)
    .all();

  let latest = null;
  if (rows.length > 0) {
    const latestDate = rows[rows.length - 1].date;
    const latestRows = rows.filter(r => r.date === latestDate);
    const tally = Object.fromEntries(CLUBS.map(c => [c, 0]));
    latestRows.forEach(r => tally[r.club]++);
    const winner = CLUBS.reduce((a, b) => (tally[b] > tally[a] ? b : a), CLUBS[0]);
    const winnerVotes = tally[winner];
    latest = {
      date: latestDate,
      winner,
      hasMajority: winnerVotes > latestRows.length - winnerVotes,
      confidence: winnerVotes / latestRows.length,
      covers: latestRows.map(r => ({
        newspaper: r.newspaper,
        name: PAPER_NAMES[r.newspaper],
        club: r.club,
        votes_club: r.votes_club,
        votes_total: r.votes_total,
        url: r.url,
        thumb_url: r.thumb_url,
      })),
    };
  }

  return json({ rows, latest });
}
