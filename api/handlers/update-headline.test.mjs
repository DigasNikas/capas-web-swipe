/**
 * Self-check: node api/handlers/update-headline.test.mjs
 */
import assert from "node:assert";
import { handleUpdateHeadline } from "./update-headline.js";

function fakeEnv() {
  const updated = [];
  const DB = {
    updated,
    prepare(sql) {
      const stmt = {
        bind: (...args) => ((stmt.args = args), stmt),
        async run() {
          if (sql.includes("UPDATE")) {
            updated.push(stmt.args);
            return {};
          }
          throw new Error(`unexpected query: ${sql}`);
        },
      };
      return stmt;
    },
  };
  return { DB, ADMIN_SECRET: "s3cret" };
}

const req = (auth, body) =>
  new Request("https://x/update-headline", {
    method: "POST",
    headers: auth ? { Authorization: `Bearer ${auth}` } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });

{
  const res = await handleUpdateHeadline(req(undefined, { id: 1, headlines: "x" }), fakeEnv());
  assert.equal(res.status, 401);
}

{
  const res = await handleUpdateHeadline(req("s3cret", { headlines: "x" }), fakeEnv());
  assert.equal(res.status, 400, "id required");
}

{
  const res = await handleUpdateHeadline(req("s3cret", { id: 1 }), fakeEnv());
  assert.equal(res.status, 400, "headlines required");
}

{
  const env = fakeEnv();
  const res = await handleUpdateHeadline(req("s3cret", { id: 42, headlines: "Palhinha já é da casa" }), env);
  assert.equal(res.status, 200);
  assert.deepEqual(env.DB.updated, [["Palhinha já é da casa", 42]]);
}

console.log("ok");
