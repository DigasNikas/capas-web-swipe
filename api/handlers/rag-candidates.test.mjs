/**
 * Self-check: node api/handlers/rag-candidates.test.mjs
 *
 * This endpoint decides how many Llama4 calls a rag-classify.yml run makes,
 * so its cap is the thing standing between a scheduled run and the quota
 * incident in rag.md's Quota section. Worth pinning.
 */
import assert from "node:assert";
import { handleRagCandidates } from "./rag-candidates.js";

function fakeEnv(rows) {
  const DB = {
    lastArgs: null,
    sql: "",
    prepare(sql) {
      DB.sql = sql;
      const stmt = {
        bind: (...args) => ((DB.lastArgs = args), stmt),
        async all() {
          if (sql.includes("ai_club IS NULL")) return { results: rows };
          throw new Error(`unexpected query: ${sql}`);
        },
      };
      return stmt;
    },
  };
  return { DB, ADMIN_SECRET: "s3cret" };
}

const req = (auth, qs = "") =>
  new Request(`https://x/rag-candidates${qs}`, {
    headers: auth ? { Authorization: `Bearer ${auth}` } : {},
  });

assert.equal((await handleRagCandidates(req(), fakeEnv([]))).status, 401);

{
  const rows = [{ id: 1, newspaper: "record", date: "2025-01-01", r2_key: "k", url: "u", headlines: "Águias voam" }];
  const env = fakeEnv(rows);
  const res = await handleRagCandidates(req("s3cret"), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), rows);
  assert.equal(env.DB.lastArgs[0], 10, "default batch stays small");
}

// The script embeds the lead headline against the text index and drops
// same-day siblings from the result, so it needs both columns back.
{
  const env = fakeEnv([]);
  await handleRagCandidates(req("s3cret"), env);
  assert.ok(env.DB.sql.includes("headlines"), "returns the text to embed");
  assert.ok(env.DB.sql.includes("date"), "returns the date the query filters on");
}

{
  const env = fakeEnv([]);
  await handleRagCandidates(req("s3cret", "?limit=999"), env);
  assert.equal(env.DB.lastArgs[0], 50, "cap holds");
}

// LIMIT -1 is unbounded in SQLite: the whole unclassified backlog in one run,
// which is exactly the shape that starved the daily neuron allowance before.
{
  const env = fakeEnv([]);
  const res = await handleRagCandidates(req("s3cret", "?limit=-1"), env);
  assert.equal(res.status, 400);
  assert.equal(env.DB.lastArgs, null, "rejected before the query runs");
}

console.log("ok");
