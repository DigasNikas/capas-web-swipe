/**
 * Self-check: node api/handlers/label-consensus.test.mjs
 */
import assert from "node:assert";
import { handleLabelConsensus } from "./label-consensus.js";

function fakeEnv() {
  const DB = {
    sql: "", args: null,
    prepare(sql) {
      DB.sql = sql;
      return { bind: (...a) => (DB.args = a, { run: async () => ({ success: true }) }) };
    },
  };
  return { DB, ADMIN_SECRET: "s3cret" };
}

const post = (body, auth = "s3cret") =>
  new Request("https://x/label-consensus", {
    method: "POST",
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const good = { cover_id: 42, club: "porto", agreed: 6, of: 7, rag_cover_ids: ["1", "2"] };

assert.equal((await handleLabelConsensus(post(good, "wrong"), fakeEnv())).status, 401);

{
  const env = fakeEnv();
  const res = await handleLabelConsensus(post(good), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, cover_id: 42, club: "porto" });
  const [club, headline, why, rag, source, id] = env.DB.args;
  assert.equal(club, "porto");
  assert.equal(headline, "", "no model read the image, so nothing was quoted");
  assert.match(why, /6 of 7/, "the margin is recorded, not just the verdict");
  assert.equal(rag, '["1","2"]');
  assert.equal(source, "consensus", "tellable apart from a model label in one query");
  assert.equal(id, 42);
}

// The threshold is enforced here too, not only in the script that calls this.
// A client bug that sent a 4-of-7 majority would otherwise write a label the
// measurement says is right 69% of the time.
{
  const env = fakeEnv();
  const res = await handleLabelConsensus(post({ ...good, agreed: 4 }), env);
  assert.equal(res.status, 400);
  assert.equal(env.DB.args, null, "nothing written");
}

// Only the four real clubs, and only with a cover to attach them to.
for (const bad of [{ ...good, club: "liverpool" }, { ...good, club: null }, { ...good, cover_id: null }]) {
  const env = fakeEnv();
  assert.equal((await handleLabelConsensus(post(bad), env)).status, 400);
  assert.equal(env.DB.args, null);
}

console.log("label-consensus: ok");
