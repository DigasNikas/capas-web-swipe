/**
 * Self-check for the day verdict: node api/handlers/stats.test.mjs
 *
 * The crowd's side only. The model's verdict moved to /detector — see
 * detector.test.mjs — so what is left here is the day winner, the majority
 * rule, and that ai_* no longer rides along on every row.
 */
import assert from "node:assert";
import { handleStats } from "./stats.js";

const row = (date, newspaper, club) => ({
  cover_id: `${date}-${newspaper}`, newspaper, date, club,
  votes_club: 5, votes_total: 10, url: "u", thumb_url: "t",
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
assert.ok(!("latestAi" in (await stats([row("2026-08-24", "record", "porto")]))));

// Empty archive: no verdict rather than a made-up one.
({ latest } = await stats([]));
assert.equal(latest, null);

console.log("stats: ok");
