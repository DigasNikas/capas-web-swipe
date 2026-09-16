/**
 * Self-check: node api/lib/scrape-day.test.mjs
 *
 * One scrape of one day, run repeatedly. Every cron runs the same code and
 * converges on the same row: the cover is stored once, the titles are filled
 * whenever capasjornais.pt has turned over, and a run with nothing left to do
 * fetches nothing at all.
 */
import assert from "node:assert";
import { NEWSPAPERS, scrapeDay, scrapeNewspaper } from "./scraper.js";

const TODAY = new Date().toISOString().slice(0, 10);
const MONTHS = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const heading = date =>
  `${Number(date.slice(8))} de ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
const page = (date, text) =>
  `<h2 class="BottomNews">Títulos da Capa de ${heading(date)}</h2><ul><li><span>${text}</span></li></ul>`;

// D1 + R2 + Images stubs, routed on the SQL text like the handler tests.
function fakeEnv(rows = []) {
  const state = { rows, puts: [], fetched: [] };
  const DB = {
    prepare(sql) {
      const stmt = {
        bind: (...args) => ((stmt.args = args), stmt),
        async first() {
          const [newspaper, date] = stmt.args;
          return state.rows.find(r => r.newspaper === newspaper && r.date === date) ?? null;
        },
        async run() {
          if (sql.startsWith("INSERT")) {
            const [newspaper, date, r2_key, url, thumb_url, headlines] = stmt.args;
            state.rows.push({ id: state.rows.length + 1, newspaper, date, r2_key, url, thumb_url, headlines });
          } else if (sql.startsWith("UPDATE")) {
            const [headlines, id] = stmt.args;
            state.rows.find(r => r.id === id).headlines = headlines;
          } else {
            throw new Error(`unexpected SQL: ${sql}`);
          }
          return {};
        },
      };
      return stmt;
    },
  };
  return {
    ...state,
    DB,
    R2_PUBLIC_URL: "https://img.example",
    COVERS_BUCKET: { put: async key => state.puts.push(key) },
    IMAGES: { input: () => ({ transform: () => ({ output: async () => ({ response: () => ({ body: "thumb" }) }) }) }) },
    state,
  };
}

// fetch stub: an image for any .jpg, and a headlines page showing `edition`.
function stubFetch(env, edition, text = "hoje") {
  globalThis.fetch = async (url) => {
    env.state.fetched.push(url);
    if (url.endsWith(".jpg")) {
      return { ok: true, headers: new Headers({ "content-type": "image/jpeg" }), body: { tee: () => ["full", "thumb"] } };
    }
    return { ok: true, headers: new Headers(), text: async () => page(edition, text) };
  };
}

const paper = NEWSPAPERS[0];
const row = env => env.state.rows[0];

// First run of the day, page still on yesterday's edition: cover stored,
// titles left empty, and the day is not complete.
{
  const env = fakeEnv();
  stubFetch(env, "2020-08-12");
  const status = await scrapeNewspaper(paper, new Date(), env);
  assert.equal(status, "pending");
  assert.equal(env.state.rows.length, 1);
  assert.equal(row(env).headlines, null);
  assert.equal(env.state.puts.length, 2, "cover and thumbnail");
}

// Later run, same day, page has turned over: the existing row gains its
// titles. No second cover download.
{
  const env = fakeEnv();
  stubFetch(env, "2020-08-12");
  await scrapeNewspaper(paper, new Date(), env);
  const putsAfterFirst = env.state.puts.length;

  stubFetch(env, TODAY, "manchete de hoje");
  const status = await scrapeNewspaper(paper, new Date(), env);
  assert.equal(status, "complete");
  assert.equal(row(env).headlines, "manchete de hoje");
  assert.equal(env.state.rows.length, 1, "still one row for the day");
  assert.equal(env.state.puts.length, putsAfterFirst, "the image is not fetched or stored again");
}

// Nothing left to do: no request of any kind.
{
  const env = fakeEnv([{ id: 1, newspaper: paper.slug, date: TODAY, headlines: "already here" }]);
  stubFetch(env, TODAY);
  env.state.fetched.length = 0;
  const status = await scrapeNewspaper(paper, new Date(), env);
  assert.equal(status, "complete");
  assert.deepEqual(env.state.fetched, [], "a settled cover costs nothing to re-scrape");
}

// A past date has no headline source, so it is complete once the cover is
// stored — otherwise a backfill would never finish.
{
  const env = fakeEnv();
  stubFetch(env, TODAY);
  const status = await scrapeNewspaper(paper, new Date("2025-03-05T00:00:00Z"), env);
  assert.equal(status, "complete");
  assert.equal(row(env).headlines, null);
}

// No cover anywhere: nothing is written, and the day stays incomplete.
{
  const env = fakeEnv();
  globalThis.fetch = async () => ({ ok: false });
  const status = await scrapeNewspaper(paper, new Date(), env);
  assert.equal(status, "failed");
  assert.equal(env.state.rows.length, 0);
}

// scrapeDay is complete only when every newspaper is.
{
  const env = fakeEnv();
  stubFetch(env, TODAY, "manchete");
  assert.equal(await scrapeDay(env, new Date()), true);
  assert.equal(env.state.rows.length, NEWSPAPERS.length);
}
{
  const env = fakeEnv();
  stubFetch(env, "2020-08-12");
  assert.equal(await scrapeDay(env, new Date()), false, "titles still missing");
}

// One newspaper throwing must not stop the others or the day's report.
{
  const env = fakeEnv();
  stubFetch(env, TODAY, "manchete");
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.includes(NEWSPAPERS[1].capasjornais)) throw new Error("boom");
    return realFetch(url);
  };
  assert.equal(await scrapeDay(env, new Date()), false);
  assert.equal(env.state.rows.length, NEWSPAPERS.length - 1);
}

console.log("scrape-day: ok");
