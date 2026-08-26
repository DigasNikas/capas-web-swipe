import { json } from "../lib/http.js";

const CLUBS = ["sporting", "benfica", "porto", "others"];
const PAPER_NAMES = { abola: "A Bola", ojogo: "O Jogo", record: "Record" };

// Confidence is "how many of the day's papers agreed", for both the crowd
// verdict (key 'club') and the model's (key 'ai_club') — same three papers,
// same arithmetic, so the two readouts are directly comparable.
function verdict(rows, key) {
  const tally = Object.fromEntries(CLUBS.map(c => [c, 0]));
  rows.forEach(r => tally[r[key]]++);
  const winner = CLUBS.reduce((a, b) => (tally[b] > tally[a] ? b : a), CLUBS[0]);
  const winnerVotes = tally[winner];
  return {
    winner,
    hasMajority: winnerVotes > rows.length - winnerVotes,
    confidence: winnerVotes / rows.length,
  };
}

// Public — reads only analytics_covers (+ covers for image URLs and the model's
// own guess), never swipes. Returns raw per-cover rows; the dashboard
// aggregates them (by época, by paper, by day) client-side so filtering doesn't
// need another round trip.
export async function handleStats(env) {
  const { results: rows } = await env.DB
    .prepare(`
      SELECT ac.cover_id, ac.newspaper, ac.date, ac.club, ac.votes_club, ac.votes_total,
             c.url, COALESCE(c.thumb_url, c.url) AS thumb_url, c.ai_club, c.ai_headline
      FROM analytics_covers ac
      JOIN covers c ON c.id = ac.cover_id
      ORDER BY ac.date ASC
    `)
    .all();

  let latest = null;
  let latestAi = null;

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

    // The model only has an opinion on covers it has actually seen — a paper
    // the backfill hasn't reached yet is left out rather than counted as a
    // miss, so an in-progress backfill can't skew the day's verdict.
    const aiRows = latestRows.filter(r => r.ai_club);
    if (aiRows.length > 0) {
      const labelled = rows.filter(r => r.ai_club);
      latestAi = {
        date: latestDate,
        ...verdict(aiRows, "ai_club"),
        // Headline number of the whole feature: how often the model landed on
        // the same club as the crowd, across every cover it has classified.
        agreement: labelled.filter(r => r.ai_club === r.club).length / labelled.length,
        labelled: labelled.length,
        // headline: the biggest headline the model read on that page — its
        // justification for the club it named, shown next to the verdict.
        covers: aiRows.map(r => ({ ...cover(r), club: r.ai_club, human_club: r.club, headline: r.ai_headline || null })),
      };
    }
  }

  return json({ rows, latest, latestAi });
}
