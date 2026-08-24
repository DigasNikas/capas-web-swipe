/**
 * Self-check for the comment gate: node api/handlers/comments.test.mjs
 *
 * Covers the two things that are not obvious by reading — Google token
 * rejection and the day-scoped rate limits. Stubs fetch and D1; no network,
 * no wrangler, no database.
 */
import assert from "node:assert";
import { handlePostComment } from "./comments.js";

const CLIENT_ID = "107331929504-16jvt0ml8gago9iofrd2sqtg1barsob6.apps.googleusercontent.com";
const GOOD = { aud: CLIENT_ID, sub: "u1", given_name: "Diogo", name: "Diogo Nicolau" };

// D1 stub: routes on the SQL text, since the handler only issues three queries.
function fakeEnv({ latest = "2026-08-23", n = 0, since = 9999 } = {}) {
  const inserted = [];
  const DB = {
    inserted,
    prepare(sql) {
      const stmt = {
        bind: (...args) => ((stmt.args = args), stmt),
        async first() {
          if (sql.includes("MAX(date)")) return { d: latest };
          if (sql.includes("COUNT(*)")) return { n, since };
          if (sql.includes("INSERT")) {
            inserted.push(stmt.args);
            const [date, author, , body] = stmt.args;
            return { id: 1, author, body, created_at: `${date} 12:00:00` };
          }
          throw new Error(`unexpected query: ${sql}`);
        },
      };
      return stmt;
    },
  };
  return { DB };
}

function stubGoogle(payload) {
  globalThis.fetch = async () =>
    payload ? { ok: true, json: async () => payload } : { ok: false, json: async () => ({}) };
}

const req = (body, id_token = "tok") =>
  new Request("https://x/comments", { method: "POST", body: JSON.stringify({ id_token, body }) });

const status = (body, env = fakeEnv()) => handlePostComment(req(body), env).then(r => r.status);

// Rejected tokens never reach the database.
stubGoogle(null);
assert.equal(await status("olá"), 401, "Google rejection -> 401");

// A valid token minted for someone else's client id is still a forgery.
stubGoogle({ ...GOOD, aud: "someone-elses-client" });
assert.equal(await status("olá"), 401, "wrong aud -> 401");

stubGoogle({ aud: CLIENT_ID, given_name: "Diogo" }); // no sub
assert.equal(await status("olá"), 401, "missing sub -> 401");

stubGoogle(GOOD);
assert.equal(await status("   "), 400, "blank body -> 400");
assert.equal(await status("x".repeat(241)), 400, "241 chars -> 400");

// Both limits read off the same day-scoped query.
assert.equal(await status("olá", fakeEnv({ n: 5 })), 429, "6th of the day -> 429");
assert.equal(await status("olá", fakeEnv({ n: 1, since: 30 })), 429, "30s cooldown -> 429");

// No covers scraped yet -> nothing to comment on.
assert.equal(await status("olá", fakeEnv({ latest: null })), 409, "no cover day -> 409");

// Happy path: server picks the date, stores the opaque sub, first name only.
const env = fakeEnv({ n: 1, since: 120 });
const res = await handlePostComment(req("  capas fracas  "), env);
assert.equal(res.status, 201);
assert.deepEqual(env.DB.inserted[0], ["2026-08-23", "Diogo", "u1", "capas fracas"]);
assert.equal((await res.json()).author, "Diogo");

console.log("ok");
