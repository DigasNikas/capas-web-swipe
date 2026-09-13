/**
 * Self-check: node api/handlers/backfill-headlines.test.mjs
 *
 * Stubs D1 and fetch — no network, no wrangler. Covers the auth gate, the
 * today-only date scope (capasjornais.pt has no per-date page, see
 * scraper.js's fetchHeadlines), that text from another edition is refused,
 * and that a fetch failure for one row doesn't stop the batch.
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
          if (sql.includes("SELECT")) return { results: rows };
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

const page = (dateLabel, text) =>
  `<h2 class="BottomNews">Títulos da Capa de ${dateLabel}</h2><ul><li><span>${text}</span></li></ul>`;
const todayHeading = `${Number(TODAY.slice(8))} de ${["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"][Number(TODAY.slice(5, 7)) - 1]} ${TODAY.slice(0, 4)}`;

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

// Every cover of today is refreshed, including one that already has text:
// the archive is full of rows holding the previous edition's headlines, and
// this endpoint is how today's get corrected once the page catches up.
{
  const rows = [
    { id: 1, newspaper: "record", date: TODAY, headlines: null },
    { id: 2, newspaper: "abola", date: TODAY, headlines: null },
    { id: 3, newspaper: "ojogo", date: TODAY, headlines: "yesterday's text" },
  ];
  const env = fakeEnv(rows);

  globalThis.fetch = async (url) => ({
    ok: true,
    text: async () =>
      url.includes("A-Bola") ? page(todayHeading, "abola headline")
      : url.includes("O-Jogo") ? page(todayHeading, "ojogo headline")
      : page(todayHeading, "record headline"),
  });

  const res = await handleBackfillHeadlines(req("s3cret"), env);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.done, 3);
  assert.deepEqual(env.DB.updated, [
    { id: 1, headlines: "record headline" },
    { id: 2, headlines: "abola headline" },
    { id: 3, headlines: "ojogo headline" },
  ]);
}

// The page is still showing yesterday's edition: nothing is written. This is
// the bug the whole archive carries — the scrape runs at 05:00 UTC, when the
// page has not turned over yet.
{
  const rows = [{ id: 1, newspaper: "record", date: TODAY, headlines: null }];
  const env = fakeEnv(rows);
  globalThis.fetch = async () => ({ ok: true, text: async () => page("12 de agosto 2020", "an older edition") });

  const body = await (await handleBackfillHeadlines(req("s3cret"), env)).json();
  assert.equal(body.done, 0);
  assert.deepEqual(env.DB.updated, []);
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
      : { ok: true, text: async () => page(todayHeading, "record headline") };

  const res = await handleBackfillHeadlines(req("s3cret"), env);
  const body = await res.json();

  assert.equal(body.done, 1, "the failed row is skipped, not counted as done");
  assert.deepEqual(env.DB.updated, [{ id: 1, headlines: "record headline" }]);
}

console.log("ok");
