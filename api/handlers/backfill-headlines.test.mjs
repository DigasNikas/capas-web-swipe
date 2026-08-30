/**
 * Self-check: node api/handlers/backfill-headlines.test.mjs
 *
 * Stubs D1 and fetch — no network, no wrangler. Covers the auth gate, the
 * today-only date scope (capasjornais.pt has no per-date page, see
 * scraper.js's fetchHeadlines), and that a fetch failure for one row
 * doesn't stop the batch.
 */
import assert from "node:assert";
import { handleBackfillHeadlines } from "./backfill-headlines.js";

const TODAY = new Date().toISOString().slice(0, 10);

// D1 stub: routes on the SQL text, same convention as comments.test.mjs.
function fakeEnv(rows) {
  const updated = [];
  const DB = {
    updated,
    prepare(sql) {
      const stmt = {
        bind: (...args) => ((stmt.args = args), stmt),
        async all() {
          if (sql.includes("SELECT")) return { results: rows.filter(r => r.headlines === null) };
          throw new Error(`unexpected query (all): ${sql}`);
        },
        async run() {
          if (sql.includes("UPDATE")) {
            const [headlines, id] = stmt.args;
            const row = rows.find(r => r.id === id);
            row.headlines = headlines;
            updated.push({ id, headlines });
            return {};
          }
          throw new Error(`unexpected query (run): ${sql}`);
        },
      };
      return stmt;
    },
  };
  return { DB, ADMIN_SECRET: "s3cret" };
}

const req = (auth) =>
  new Request("https://x/backfill-headlines", {
    method: "POST",
    headers: auth ? { Authorization: `Bearer ${auth}` } : {},
  });

// No token, no query.
{
  const env = fakeEnv([]);
  const res = await handleBackfillHeadlines(req(), env);
  assert.equal(res.status, 401);
}

// Wrong token.
{
  const env = fakeEnv([]);
  const res = await handleBackfillHeadlines(req("wrong"), env);
  assert.equal(res.status, 401);
}

// Two rows missing headlines, one already has them (should be untouched —
// the SQL WHERE headlines IS NULL already excludes it, this just confirms
// the stub's filtering matches what the real query would do).
{
  const rows = [
    { id: 1, newspaper: "record", date: TODAY, headlines: null },
    { id: 2, newspaper: "abola", date: TODAY, headlines: null },
    { id: 3, newspaper: "ojogo", date: TODAY, headlines: "already set" },
  ];
  const env = fakeEnv(rows);

  globalThis.fetch = async (url) => ({
    ok: true,
    text: async () =>
      url.includes("A-Bola")
        ? `<h2 class="BottomNews">t</h2><ul><li><span>abola headline</span></li></ul>`
        : `<h2 class="BottomNews">t</h2><ul><li><span>record headline</span></li></ul>`,
  });

  const res = await handleBackfillHeadlines(req("s3cret"), env);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.done, 2, "only the two NULL rows get processed");
  assert.deepEqual(env.DB.updated, [
    { id: 1, headlines: "record headline" },
    { id: 2, headlines: "abola headline" },
  ]);
}

// A dead fetch for one row must not stop the batch or throw.
{
  const rows = [
    { id: 1, newspaper: "record", date: TODAY, headlines: null },
    { id: 2, newspaper: "abola", date: TODAY, headlines: null },
  ];
  const env = fakeEnv(rows);

  globalThis.fetch = async (url) =>
    url.includes("A-Bola")
      ? { ok: false }
      : { ok: true, text: async () => `<h2 class="BottomNews">t</h2><ul><li><span>record headline</span></li></ul>` };

  const res = await handleBackfillHeadlines(req("s3cret"), env);
  const body = await res.json();

  assert.equal(body.done, 1, "the failed row is skipped, not counted as done");
  assert.deepEqual(env.DB.updated, [{ id: 1, headlines: "record headline" }]);
}

console.log("ok");
