/**
 * Self-check for the leaderboard drill-down's streak math:
 *   node api/handlers/user-stats.test.mjs
 *
 * D1 is stubbed by SQL substring (two different prepared statements share
 * one handler call), no wrangler needed.
 */
import assert from "node:assert";
import { handleUserStats } from "./user-stats.js";

function fakeEnv({ breakdown = [], days = [] }) {
  return {
    DB: {
      prepare: sql => ({
        bind: () => ({
          all: async () => sql.includes("GROUP BY decision")
            ? { results: breakdown }
            : { results: days },
        }),
      }),
    },
  };
}

const request = { headers: { get: h => h === "Cf-Access-Authenticated-User-Email" ? "me@example.com" : null } };
const url = new URL("https://x/user-stats?email=other@example.com");
const stats = env => handleUserStats(request, env, url).then(r => r.json());

const day = (voted, total = 3) => ({ voted_covers: voted, total_covers: total });

// Breakdown: raw counts pass straight through, keyed by decision.
let data = await stats(fakeEnv({
  breakdown: [{ decision: "benfica", count: 7 }, { decision: "porto", count: 5 }],
}));
assert.deepEqual(data.breakdown, { benfica: 7, porto: 5 });

// A 5-day complete run bookended by TWO incomplete days after it — this is
// the shape checked directly against live D1 before writing this handler
// (joaolopes2602@gmail.com, 2026-04-25..29, with every later archive day at
// 0 votes). Best streak finds the run; current streak is 0 because more
// than one trailing day is incomplete — long broken, not "today in progress".
data = await stats(fakeEnv({
  days: [day(0), day(3), day(3), day(3), day(3), day(3), day(0), day(0)],
}));
assert.equal(data.bestStreak, 5);
assert.equal(data.currentStreak, 0);

// Same run, but only the single most recent day is incomplete — "hasn't
// gotten to today yet" shouldn't retroactively break an otherwise-live
// streak, so only that one trailing day is skipped before counting back.
data = await stats(fakeEnv({
  days: [day(0), day(3), day(3), day(3), day(3), day(3), day(1)],
}));
assert.equal(data.currentStreak, 5);

// No archive days at all.
data = await stats(fakeEnv({ days: [] }));
assert.equal(data.currentStreak, 0);
assert.equal(data.bestStreak, 0);

// Unauthenticated request.
const anon = { headers: { get: () => null } };
const res = await handleUserStats(anon, fakeEnv({}), url);
assert.equal(res.status, 401);

console.log("user-stats: ok");
