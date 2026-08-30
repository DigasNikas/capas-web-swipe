/**
 * Self-check: node api/handlers/headline-candidates.test.mjs
 */
import assert from "node:assert";
import { handleHeadlineCandidates } from "./headline-candidates.js";

function fakeEnv(rows) {
  const DB = {
    lastArgs: null,
    prepare(sql) {
      const stmt = {
        bind: (...args) => ((DB.lastArgs = args), stmt),
        async all() {
          if (sql.includes("SELECT")) return { results: rows };
          throw new Error(`unexpected query: ${sql}`);
        },
      };
      return stmt;
    },
  };
  return { DB, ADMIN_SECRET: "s3cret" };
}

const req = (auth, qs = "") =>
  new Request(`https://x/headline-candidates${qs}`, {
    headers: auth ? { Authorization: `Bearer ${auth}` } : {},
  });

{
  const res = await handleHeadlineCandidates(req(), fakeEnv([]));
  assert.equal(res.status, 401);
}

{
  const rows = [{ id: 1, newspaper: "record", date: "2025-01-01" }];
  const env = fakeEnv(rows);
  const res = await handleHeadlineCandidates(req("s3cret"), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), rows);
}

// limit is capped, not passed through unbounded.
{
  const env = fakeEnv([]);
  await handleHeadlineCandidates(req("s3cret", "?limit=999999"), env);
  assert.equal(env.DB.lastArgs[0], 2000, "limit caps at 2000");
}

console.log("ok");
