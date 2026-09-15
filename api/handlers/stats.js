import { json } from "../lib/http.js";
import { verdict } from "../lib/verdict.js";

const PAPER_NAMES = { abola: "A Bola", ojogo: "O Jogo", record: "Record" };

// Public — reads only analytics_covers (+ covers for image URLs), never
// swipes. Returns raw per-cover rows; the dashboard aggregates them (by época,
// by paper, by day) client-side so filtering doesn't need another round trip.
//
// The model's side lives in /detector, not here. It used to ride along as
// ai_club/ai_headline/ai_why on every row plus a latestAi block — 17% of a
// 600KB payload, for data the calendar never reads, sharing one cache entry
// with an archive dump that changes on a completely different schedule.
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

    const cover = r => ({
      newspaper: r.newspaper,
      name: PAPER_NAMES[r.newspaper],
      url: r.url,
      thumb_url: r.thumb_url,
    });

    latest = {
      date: latestDate,
      ...verdict(latestRows, "club"),
      covers: latestRows.map(r => ({
        ...cover(r),
        club: r.club,
        votes_club: r.votes_club,
        votes_total: r.votes_total,
      })),
    };
  }

  return json({ rows, latest });
}
