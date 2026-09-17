import { json } from "../lib/http.js";
import { verdict } from "../lib/verdict.js";

const PAPER_NAMES = { abola: "A Bola", ojogo: "O Jogo", record: "Record" };

// "Posse de bola dividida": the covers the crowd split over. Computed here
// rather than client-side because the per-club counts are ~40KB of payload
// nothing else on the dashboard reads.
const DIVIDED_MIN_VOTES = 5;   // below this a "split" is one person disagreeing
const DIVIDED_LIMIT = 6;

function dividedCovers(rows) {
  return rows
    .filter(r => r.votes_total >= DIVIDED_MIN_VOTES && r.votes_club < r.votes_total)
    .sort((a, b) => a.votes_club / a.votes_total - b.votes_club / b.votes_total)
    .slice(0, DIVIDED_LIMIT)
    .map(r => ({
      cover_id: r.cover_id,
      newspaper: r.newspaper,
      name: PAPER_NAMES[r.newspaper],
      date: r.date,
      url: r.url,
      thumb_url: r.thumb_url,
      club: r.club,
      votes_club: r.votes_club,
      votes_total: r.votes_total,
      votes: {
        benfica: r.votes_benfica,
        sporting: r.votes_sporting,
        porto: r.votes_porto,
        others: r.votes_others,
      },
    }));
}

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
             ac.votes_benfica, ac.votes_sporting, ac.votes_porto, ac.votes_others,
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

  // The per-club counts are stripped from the rows: `divided` is their only
  // reader, and 1,800 rows carrying four extra numbers each is payload the
  // calendar pays for and never reads.
  const publicRows = rows.map(({ votes_benfica, votes_sporting, votes_porto, votes_others, ...rest }) => rest);
  return json({ rows: publicRows, latest, divided: dividedCovers(rows) });
}
