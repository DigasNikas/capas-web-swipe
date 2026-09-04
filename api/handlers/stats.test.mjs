/**
 * Self-check for the day verdict: node api/handlers/stats.test.mjs
 *
 * Covers what the AI detector added — a second verdict computed over the same
 * rows with a different column, the "papers the backfill hasn't reached yet are
 * left out" rule, and the agreement number. D1 is stubbed; no wrangler.
 */
import assert from "node:assert";
import { handleStats } from "./stats.js";

const row = (date, newspaper, club, ai_club) => ({
  cover_id: `${date}-${newspaper}`, newspaper, date, club, ai_club,
  votes_club: 5, votes_total: 10, url: "u", thumb_url: "t",
});

const fakeEnv = rows => ({
  DB: { prepare: () => ({ all: async () => ({ results: rows }) }) },
});

const stats = rows => handleStats(fakeEnv(rows)).then(r => r.json());

// Two of three papers agree, and so does the model — but on a different club.
let { latest, latestAi } = await stats([
  row("2026-08-23", "record", "benfica", "benfica"),
  row("2026-08-24", "record", "porto", "sporting"),
  row("2026-08-24", "abola", "porto", "sporting"),
  row("2026-08-24", "ojogo", "benfica", "benfica"),
]);
assert.equal(latest.winner, "porto");
assert.equal(latest.hasMajority, true);
assert.equal(latestAi.winner, "sporting");
assert.equal(latestAi.confidence, 2 / 3);
// 4 labelled covers, 2 of them matching the crowd.
assert.equal(latestAi.labelled, 4);
assert.equal(latestAi.agreement, 0.5);

// A 1-1-1 split is nobody's day.
({ latestAi } = await stats([
  row("2026-08-24", "record", "porto", "porto"),
  row("2026-08-24", "abola", "porto", "benfica"),
  row("2026-08-24", "ojogo", "porto", "sporting"),
]));
assert.equal(latestAi.hasMajority, false);

// Mid-backfill: the unlabelled paper is absent, not counted as a miss, so one
// classified cover is a 100%-confident verdict rather than a 33% one.
({ latestAi } = await stats([
  row("2026-08-24", "record", "porto", "porto"),
  row("2026-08-24", "abola", "porto", null),
  row("2026-08-24", "ojogo", "porto", null),
]));
assert.equal(latestAi.covers.length, 1);
assert.equal(latestAi.confidence, 1);

// Nothing classified yet — the section stays hidden, the crowd one does not.
({ latest, latestAi } = await stats([row("2026-08-24", "record", "porto", null)]));
assert.equal(latestAi, null);
assert.equal(latest.winner, "porto");

console.log("stats: ok");
