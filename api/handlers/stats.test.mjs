/**
 * Self-check for the day verdict: node api/handlers/stats.test.mjs
 *
 * The crowd's side only. The model's verdict moved to /detector — see
 * detector.test.mjs — so what is left here is the day winner, the majority
 * rule, and that ai_* no longer rides along on every row.
 */
import assert from "node:assert";
import { handleStats } from "./stats.js";

const row = (date, newspaper, club, votes = {}) => ({
  cover_id: `${date}-${newspaper}`, newspaper, date, club,
  votes_club: votes.club ?? 5, votes_total: votes.total ?? 10,
  votes_benfica: votes.benfica ?? 0, votes_sporting: votes.sporting ?? 0,
  votes_porto: votes.porto ?? 0, votes_others: votes.others ?? 0,
  url: "u", thumb_url: "t",
});

const fakeEnv = rows => ({
  DB: { prepare: () => ({ all: async () => ({ results: rows }) }) },
});

const stats = rows => handleStats(fakeEnv(rows)).then(r => r.json());

// Two of the day's three papers agree. Yesterday's row is not the day.
let { rows, latest } = await stats([
  row("2026-08-23", "record", "benfica"),
  row("2026-08-24", "record", "porto"),
  row("2026-08-24", "abola", "porto"),
  row("2026-08-24", "ojogo", "benfica"),
]);
assert.equal(latest.date, "2026-08-24");
assert.equal(latest.winner, "porto");
assert.equal(latest.hasMajority, true);
assert.equal(latest.confidence, 2 / 3);
assert.equal(latest.covers.length, 3);

// A 1-1-1 split is nobody's day.
({ latest } = await stats([
  row("2026-08-24", "record", "porto"),
  row("2026-08-24", "abola", "benfica"),
  row("2026-08-24", "ojogo", "sporting"),
]));
assert.equal(latest.hasMajority, false);

// The model's fields are gone from the payload: a dashboard still reading
// them here would silently render blanks rather than fail, so pin it.
({ rows } = await stats([row("2026-08-24", "record", "porto")]));
assert.deepEqual(Object.keys(rows[0]).filter(k => k.startsWith("ai_")), []);
// The per-club counts feed `divided` and nothing else: ~40KB of payload the
// calendar would carry for no reader.
assert.deepEqual(Object.keys(rows[0]).filter(k => k.startsWith("votes_") && k !== "votes_club" && k !== "votes_total"), []);
assert.ok(!("latestAi" in (await stats([row("2026-08-24", "record", "porto")]))));

// Empty archive: no verdict rather than a made-up one.
({ latest } = await stats([]));
assert.equal(latest, null);

// The covers the crowd split over, most divided first. A cover the winner
// took outright is not divided, and one or two votes cannot show a split, so
// both are left out.
{
  const { divided } = await stats([
    row("2026-08-20", "record", "sporting", { club: 10, total: 21, benfica: 1, sporting: 10, others: 10 }),
    row("2026-08-21", "abola", "porto", { club: 13, total: 18, porto: 13, sporting: 1, others: 4 }),
    row("2026-08-22", "ojogo", "benfica", { club: 6, total: 6, benfica: 6 }),
    row("2026-08-23", "record", "porto", { club: 2, total: 3, porto: 2, others: 1 }),
  ]);
  assert.deepEqual(divided.map(d => d.date), ["2026-08-20", "2026-08-21"]);
  assert.deepEqual(divided[0].votes, { benfica: 1, sporting: 10, porto: 0, others: 10 });
  assert.equal(divided[0].votes_total, 21);
  assert.equal(divided[0].club, "sporting");
  assert.equal(divided[0].thumb_url, "t");
}

// Nothing voted enough yet: an empty list, so the section can hide itself.
{
  const { divided } = await stats([row("2026-08-24", "record", "porto", { club: 2, total: 2, porto: 2 })]);
  assert.deepEqual(divided, []);
}

console.log("stats: ok");