/**
 * Self-check for the headlines endpoint: node api/handlers/headlines.test.mjs
 *
 * D1 is stubbed; no wrangler.
 */
import assert from "node:assert";
import { handleHeadlines } from "./headlines.js";

const fakeEnv = (rows, seen = []) => ({
  DB: { prepare(sql) { seen.push(sql); return { all: async () => ({ results: rows }) }; } },
});

// Public: no Authorization header, no 401. Same reasoning as /search and
// /similarities — this is the text /search already returns, with no user
// attached to it.
const res = await handleHeadlines(fakeEnv([{ id: 1, headlines: "Aguias voam" }]));
assert.equal(res.status, 200);
assert.deepEqual(await res.json(), [{ id: 1, headlines: "Aguias voam" }]);

// Covers with no scraped text are left out rather than returned as nulls: the
// one caller builds a lookup from this and asks it about specific ids, so an
// absent id and a null value would mean the same thing anyway.
{
  const seen = [];
  await handleHeadlines(fakeEnv([], seen));
  assert.ok(seen[0].includes("headlines IS NOT NULL"));
}

console.log("headlines: ok");
