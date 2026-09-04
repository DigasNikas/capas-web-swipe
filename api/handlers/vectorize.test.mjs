/**
 * Self-check for both Vectorize progress endpoints:
 *   node api/handlers/vectorize.test.mjs
 *
 * They serve two indexes now — cover images (capas-cover-embeddings) and
 * lead headlines (capas-headline-embeddings) — off one pair of routes with
 * an `index` parameter, because the only thing that differs is which column
 * marks progress and which field the caller needs back.
 */
import assert from "node:assert";
import { handleVectorizeCandidates } from "./vectorize-candidates.js";
import { handleVectorizeMark } from "./vectorize-mark.js";

function fakeEnv(rows = []) {
  const DB = {
    sql: [],
    args: [],
    prepare(sql) {
      DB.sql.push(sql);
      const stmt = {
        bind: (...a) => (DB.args.push(a), stmt),
        all: async () => ({ results: rows }),
        run: async () => ({ success: true }),
      };
      return stmt;
    },
  };
  return { DB, ADMIN_SECRET: "s3cret" };
}

const get = (qs = "") =>
  new Request(`https://x/vectorize-candidates${qs}`, { headers: { Authorization: "Bearer s3cret" } });
const post = body =>
  new Request("https://x/vectorize-mark", {
    method: "POST",
    headers: { Authorization: "Bearer s3cret", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// --- candidates ---

// No index parameter is the image index, so build_vectorize_index.py keeps
// working unchanged.
{
  const env = fakeEnv();
  await handleVectorizeCandidates(get(), env);
  assert.ok(env.DB.sql[0].includes("c.vectorized_at IS NULL"));
  assert.ok(env.DB.sql[0].includes("c.url"), "the image builder needs somewhere to download from");
}

// The headline index needs the text, and a cover with no scraped headlines
// is not a candidate at all — it has nothing to embed.
{
  const env = fakeEnv();
  await handleVectorizeCandidates(get("?index=headline"), env);
  const sql = env.DB.sql[0];
  assert.ok(sql.includes("c.headline_vectorized_at IS NULL"));
  assert.ok(sql.includes("c.headlines IS NOT NULL"));
  assert.ok(sql.includes("c.headlines"), "returns the text to embed");
}

// Both index queries join analytics_covers: an unvoted cover has no
// trustworthy label to attach to its vector, the same rule the image index
// has always applied.
{
  const env = fakeEnv();
  await handleVectorizeCandidates(get("?index=headline"), env);
  assert.ok(env.DB.sql[0].includes("analytics_covers"));
}

// An unknown index is a 400, never a fallback to the other one — silently
// marking the wrong column would strand a backlog with no error anywhere.
{
  const env = fakeEnv();
  const res = await handleVectorizeCandidates(get("?index=nope"), env);
  assert.equal(res.status, 400);
  assert.equal(env.DB.sql.length, 0, "rejected before the query runs");
}

// --- mark ---

{
  const env = fakeEnv();
  const res = await handleVectorizeMark(post({ cover_ids: [1, 2] }), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, marked: 2 });
  assert.ok(env.DB.sql[0].includes("SET vectorized_at ="));
}

{
  const env = fakeEnv();
  await handleVectorizeMark(post({ cover_ids: [7], index: "headline" }), env);
  assert.ok(env.DB.sql[0].includes("SET headline_vectorized_at ="));
}

{
  const env = fakeEnv();
  const res = await handleVectorizeMark(post({ cover_ids: [7], index: "nope" }), env);
  assert.equal(res.status, 400);
  assert.equal(env.DB.sql.length, 0, "rejected before the update runs");
}

// Unauthorized stays unauthorized on both, with or without an index.
{
  const bare = new Request("https://x/vectorize-candidates?index=headline");
  assert.equal((await handleVectorizeCandidates(bare, fakeEnv())).status, 401);
}

console.log("vectorize: ok");
