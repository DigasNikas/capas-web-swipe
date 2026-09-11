/**
 * Self-check for the comment gate: node api/handlers/comments.test.mjs
 *
 * Covers the two things that are not obvious by reading — Google token
 * rejection and the day-scoped rate limits, including when several posts
 * arrive at once. Stubs fetch; D1 is the real schema on node:sqlite, so the
 * limits are checked against actual rows rather than a canned count.
 */
import assert from "node:assert";
import { handlePostComment } from "./comments.js";
import { freshDb, sqliteD1 } from "../test-utils/sqlite-d1.mjs";

const CLIENT_ID = "107331929504-16jvt0ml8gago9iofrd2sqtg1barsob6.apps.googleusercontent.com";
const GOOD = {
  aud: CLIENT_ID, sub: "u1", given_name: "Diogo", name: "Diogo Nicolau",
  email: "dlimanic@protonmail.com",
};
const DAY = "2026-08-23";

// A cover day to comment on, plus `n` earlier comments from u1 that day,
// the newest `ageS` seconds ago.
function seed({ latest = DAY, n = 0, ageS = 3600 } = {}) {
  const db = freshDb();
  if (latest) {
    db.prepare("INSERT INTO covers (id, newspaper, date, r2_key, url) VALUES (1, 'record', ?, 'k', 'u')").run(latest);
    db.prepare("INSERT INTO analytics_covers (cover_id, newspaper, date, club, votes_club, votes_total) VALUES (1, 'record', ?, 'porto', 1, 1)").run(latest);
  }
  for (let i = 0; i < n; i++) {
    db.prepare("INSERT INTO comments (date, author, author_sub, body, created_at) VALUES (?, 'Diogo', 'u1', 'x', datetime('now', ?))")
      .run(DAY, `-${ageS + i * 60} seconds`);
  }
  return db;
}

const countFor = (db, sub = "u1") =>
  db.prepare("SELECT COUNT(*) AS n FROM comments WHERE author_sub = ?").get(sub).n;

function stubGoogle(payload) {
  globalThis.fetch = async () =>
    payload ? { ok: true, json: async () => payload } : { ok: false, json: async () => ({}) };
}

const req = (body, id_token = "tok") =>
  new Request("https://x/comments", { method: "POST", body: JSON.stringify({ id_token, body }) });

const post = (body, DB = sqliteD1(seed())) => handlePostComment(req(body), { DB });
const status = (body, DB) => post(body, DB).then(r => r.status);

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

// Both limits read off the same day-scoped rows, and each says which one hit.
{
  const db = seed({ n: 5 });
  const res = await post("olá", sqliteD1(db));
  assert.equal(res.status, 429, "6th of the day -> 429");
  assert.match((await res.json()).error, /por dia/);
  assert.equal(countFor(db), 5);
}
{
  const db = seed({ n: 1, ageS: 30 });
  const res = await post("olá", sqliteD1(db));
  assert.equal(res.status, 429, "30s cooldown -> 429");
  assert.match((await res.json()).error, /espera/);
  assert.equal(countFor(db), 1);
}

// Yesterday's comments don't count against today.
assert.equal(await status("olá", sqliteD1(seed({ latest: "2026-08-24", n: 5 }))), 201, "new day resets the quota");

// No covers scraped yet -> nothing to comment on.
assert.equal(await status("olá", sqliteD1(seed({ latest: null }))), 409, "no cover day -> 409");

// Happy path: server picks the date, stores the opaque sub, and the author is
// first name plus the email's local-part — same identifier the app's
// leaderboard uses, so two Diogos don't read as the same person.
{
  const db = seed({ n: 1, ageS: 120 });
  const res = await post("  capas fracas  ", sqliteD1(db));
  assert.equal(res.status, 201);
  assert.equal((await res.json()).author, "Diogo - dlimanic");
  assert.deepEqual(
    { ...db.prepare("SELECT date, author, author_sub, body FROM comments ORDER BY id DESC").get() },
    { date: DAY, author: "Diogo - dlimanic", author_sub: "u1", body: "capas fracas" },
  );
}

// No email on the token (older or scope-limited clients) -> first name alone.
stubGoogle({ aud: CLIENT_ID, sub: "u2", given_name: "Ana" });
assert.equal((await (await post("boa capa")).json()).author, "Ana");
stubGoogle(GOOD);

// Parallel posts from one account. Run a second post at every point between
// the first one's round-trips: however they interleave, the limits hold.
async function race(seedOpts) {
  const outcomes = [];
  for (let gap = 0; ; gap++) {
    const db = seed(seedOpts);
    let other;
    const DB = sqliteD1(db, {
      between: async n => {
        if (n === gap) other = await status("segundo", sqliteD1(db));
      },
    });
    const first = await status("primeiro", DB);
    if (other === undefined) return outcomes;  // every gap covered
    outcomes.push({ gap, statuses: [first, other].sort(), count: countFor(db) });
  }
}

// Cooldown: with no comment yet today, only one of two simultaneous posts lands.
for (const o of await race({ n: 0 })) {
  assert.deepEqual(o.statuses, [201, 429], `cooldown, second post after trip ${o.gap}`);
  assert.equal(o.count, 1, `cooldown rows, second post after trip ${o.gap}`);
}

// Daily quota: at 4 of 5 (last one long ago), two simultaneous posts can't make 6.
for (const o of await race({ n: 4 })) {
  assert.deepEqual(o.statuses, [201, 429], `quota, second post after trip ${o.gap}`);
  assert.equal(o.count, 5, `quota rows, second post after trip ${o.gap}`);
}

console.log("comments: ok");
