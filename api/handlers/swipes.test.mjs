/**
 * Self-check for the vote write path: node api/handlers/swipes.test.mjs
 *
 * Covers what a stub can't: that only the four clubs get stored, and that
 * analytics_covers ends up right no matter where a second request's queries
 * land between this one's. Runs the real schema on node:sqlite; no wrangler.
 */
import assert from "node:assert";
import { handleSwipe } from "./swipes.js";
import { freshDb, sqliteD1 } from "../test-utils/sqlite-d1.mjs";

function seed() {
  const db = freshDb();
  db.prepare("INSERT INTO covers (id, newspaper, date, r2_key, url) VALUES (1, 'record', '2026-09-11', 'k', 'u')").run();
  return db;
}

// Every dispatch the handler fires, so "first vote" can be counted.
let dispatched = [];
globalThis.fetch = async (_url, init) => {
  dispatched.push(JSON.parse(init.body));
  return { ok: true };
};

async function swipe(DB, user, decision, cover_id = 1) {
  const pending = [];
  const env = { DB, GH_DISPATCH_TOKEN: "t", TRUST_ACCESS_EMAIL_HEADER: "1" };
  const req = new Request("https://x/swipes", {
    method: "POST",
    headers: { "Cf-Access-Authenticated-User-Email": user },
    body: JSON.stringify({ cover_id, decision }),
  });
  const res = await handleSwipe(req, env, { waitUntil: p => pending.push(p) });
  await Promise.all(pending);
  return res.status;
}

const analytics = db =>
  db.prepare("SELECT club, votes_club, votes_total FROM analytics_covers WHERE cover_id = 1").get();

const split = db =>
  db.prepare(`SELECT votes_benfica, votes_sporting, votes_porto, votes_others, votes_total
              FROM analytics_covers WHERE cover_id = 1`).get();

// Without the dev flag, the email header alone is not a login.
{
  const db = seed();
  const req = new Request("https://x/swipes", {
    method: "POST",
    headers: { "Cf-Access-Authenticated-User-Email": "a@x" },
    body: JSON.stringify({ cover_id: 1, decision: "porto" }),
  });
  const env = { DB: sqliteD1(db), ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com", ACCESS_AUD: "a" };
  assert.equal((await handleSwipe(req, env, { waitUntil() {} })).status, 401, "forged header -> 401");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM swipes").get().n, 0);
}

// Only the four clubs the app's swipe directions map to. Anything else would
// become a public analytics_covers.club the dashboard has no colour for.
{
  const db = seed();
  assert.equal(await swipe(sqliteD1(db), "a@x", "invalid"), 400, "unknown club -> 400");
  assert.equal(await swipe(sqliteD1(db), "a@x", "Sporting"), 400, "clubs are lowercase ids");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM swipes").get().n, 0);
  assert.equal(analytics(db), undefined);
}

// The schema refuses it too, for writers other than this handler.
{
  const db = seed();
  assert.throws(
    () => db.prepare("INSERT INTO swipes (user_email, cover_id, decision) VALUES ('a@x', 1, 'invalid')").run(),
    /CHECK constraint failed/,
  );
}

// Happy path, and a re-swipe moves the user's one vote rather than adding one.
{
  const db = seed();
  const DB = sqliteD1(db);
  assert.equal(await swipe(DB, "a@x", "porto"), 200);
  assert.equal(await swipe(DB, "b@x", "porto"), 200);
  assert.equal(await swipe(DB, "c@x", "benfica"), 200);
  assert.deepEqual({ ...analytics(db) }, { club: "porto", votes_club: 2, votes_total: 3 });
  await swipe(DB, "a@x", "benfica");
  assert.deepEqual({ ...analytics(db) }, { club: "benfica", votes_club: 2, votes_total: 3 });
}

// The whole split, not just the winner's count: "posse de bola dividida"
// draws a bar from it, and a re-swipe has to move the vote between columns
// rather than leave it counted twice.
{
  const db = seed();
  const DB = sqliteD1(db);
  await swipe(DB, "a@x", "porto");
  await swipe(DB, "b@x", "porto");
  await swipe(DB, "c@x", "benfica");
  await swipe(DB, "d@x", "others");
  assert.deepEqual({ ...split(db) },
    { votes_benfica: 1, votes_sporting: 0, votes_porto: 2, votes_others: 1, votes_total: 4 });

  await swipe(DB, "a@x", "sporting");
  assert.deepEqual({ ...split(db) },
    { votes_benfica: 1, votes_sporting: 1, votes_porto: 1, votes_others: 1, votes_total: 4 });
}

// Two users vote on the same cover at once. Run B's whole request at every
// point between A's round-trips: whichever order they land in, the totals
// must count both votes and the first-vote workflow must fire exactly once.
for (let gap = 0; ; gap++) {
  const db = seed();
  dispatched = [];
  let ranB = false;
  const DB_A = sqliteD1(db, {
    between: async n => {
      if (n !== gap) return;
      ranB = true;
      await swipe(sqliteD1(db), "b@x", "porto");
    },
  });
  await swipe(DB_A, "a@x", "porto");
  if (!ranB) break;  // A made fewer than gap+1 round-trips: every gap covered

  assert.deepEqual({ ...analytics(db) }, { club: "porto", votes_club: 2, votes_total: 2 }, `stale totals, B after trip ${gap}`);
  assert.equal(dispatched.length, 1, `first-vote dispatches, B after trip ${gap}`);
}

// The recompute must look swipes up by cover, not scan the whole table.
{
  const src = (await import("node:fs")).readFileSync(new URL("./swipes.js", import.meta.url), "utf8");
  const upsert = src.match(/INSERT INTO analytics_covers[\s\S]*?updated_at = excluded.updated_at/)[0];
  const plan = seed().prepare(`EXPLAIN QUERY PLAN ${upsert}`).all(1).map(r => r.detail);
  assert.ok(!plan.some(d => /^SCAN (s|swipes)\b/.test(d)), `full scan of swipes:\n${plan.join("\n")}`);
}

console.log("swipes: ok");
