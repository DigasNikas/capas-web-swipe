/**
 * Self-check: node api/handlers/rag-matches.test.mjs
 *
 * The retrieval-only write path. It must not touch ai_club: a cover with
 * neighbours recorded and no label is exactly the state this endpoint exists
 * to produce, and /rag-candidates?needs=label still has to find it.
 */
import assert from "node:assert";
import { handleRagMatches } from "./rag-matches.js";

function fakeEnv() {
  const DB = {
    sql: "",
    args: null,
    prepare(sql) {
      DB.sql = sql;
      const stmt = { bind: (...a) => ((DB.args = a), stmt), async run() { return { success: true }; } };
      return stmt;
    },
  };
  return { DB, ADMIN_SECRET: "s3cret" };
}

const req = (auth, body) =>
  new Request("https://x/rag-matches", {
    method: "POST",
    headers: auth ? { Authorization: `Bearer ${auth}` } : {},
    body: JSON.stringify(body ?? {}),
  });

assert.equal((await handleRagMatches(req(null, {}), fakeEnv())).status, 401);
assert.equal((await handleRagMatches(req("wrong", {}), fakeEnv())).status, 401);
assert.equal((await handleRagMatches(req("s3cret", { cover_id: 1 }), fakeEnv())).status, 400, "ids are not optional");
assert.equal((await handleRagMatches(req("s3cret", { rag_cover_ids: ["2"] }), fakeEnv())).status, 400);

{
  const env = fakeEnv();
  const res = await handleRagMatches(req("s3cret", { cover_id: 7, rag_cover_ids: ["2", "3"], rag_sources: ["headline", "layout"] }), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, cover_id: 7, matches: 2 });
  assert.deepEqual(env.DB.args, ['["2","3"]', '["headline","layout"]', 7]);
  assert.doesNotMatch(env.DB.sql, /ai_club/, "the label is not this endpoint's business");
}

// Retrieval that found nothing usable still counts as done, or the cover
// comes back in every future batch.
{
  const env = fakeEnv();
  const res = await handleRagMatches(req("s3cret", { cover_id: 9, rag_cover_ids: [] }), env);
  assert.equal(res.status, 200);
  assert.deepEqual(env.DB.args, ["[]", "[]", 9]);
}

console.log("ok");
