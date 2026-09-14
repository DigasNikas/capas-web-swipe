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
          if (sql.includes("ai_club IS NULL") || sql.includes("ai_rag_covers IS NULL")) return { results: rows };
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

// needs=matches asks for a different backlog: covers with no retrieval
// recorded, whatever their label. Retrieval is CLIP plus Vectorize, no Llama4
// call, so it can run when the model quota is gone — and the classify backlog
// (ai_club IS NULL) would never empty on a pass that writes no label.
{
  const env = fakeEnv([]);
  await handleRagCandidates(req("s3cret", "?needs=matches"), env);
  assert.match(env.DB.sql, /ai_rag_covers IS NULL/);
  assert.doesNotMatch(env.DB.sql, /ai_club IS NULL/);
}
{
  const env = fakeEnv([]);
  await handleRagCandidates(req("s3cret"), env);
  assert.match(env.DB.sql, /ai_club IS NULL/, "the default backlog is unchanged");
}
{
  const env = fakeEnv([]);
  const res = await handleRagCandidates(req("s3cret", "?needs=nonsense"), env);
  assert.equal(res.status, 400);
}

// The classification cap stays at 50; retrieval, which makes no model call,
// goes to 500.
{
  const env = fakeEnv([]);
  await handleRagCandidates(req("s3cret", "?limit=500"), env);
  assert.deepEqual(env.DB.lastArgs, [50], "the classification backlog is still capped at 50");
}
{
  const env = fakeEnv([]);
  await handleRagCandidates(req("s3cret", "?needs=matches&limit=500"), env);
  assert.deepEqual(env.DB.lastArgs, [500]);
}
{
  const env = fakeEnv([]);
  await handleRagCandidates(req("s3cret", "?needs=matches&limit=5000"), env);
  assert.deepEqual(env.DB.lastArgs, [500], "and capped there");
}

// date= narrows to one cover day, so a backfill does not have to walk down to
// it from the newest cover.
{
  const env = fakeEnv([]);
  await handleRagCandidates(req("s3cret", "?date=2026-09-06&limit=5"), env);
  assert.match(env.DB.sql, /date = \?2/);
  assert.deepEqual(env.DB.lastArgs, [5, "2026-09-06"]);
}
{
  const env = fakeEnv([]);
  await handleRagCandidates(req("s3cret", "?limit=5"), env);
  assert.doesNotMatch(env.DB.sql, /date = \?2/);
  assert.deepEqual(env.DB.lastArgs, [5]);
}
{
  const env = fakeEnv([]);
  assert.equal((await handleRagCandidates(req("s3cret", "?date=6-9-2026"), env)).status, 400);
}

console.log("ok");