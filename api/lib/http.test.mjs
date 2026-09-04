/**
 * Self-check for the shared HTTP helpers: node api/lib/http.test.mjs
 *
 * parseLimit is the one with a real incident behind it: `Math.min(Number(p)
 * || fallback, max)` let `?limit=-1` through, and SQLite reads LIMIT -1 as no
 * limit at all — the exact unbounded shape that starved the Workers AI quota
 * for a week (see rag.md).
 */
import assert from "node:assert";
import { json, parseLimit, requireAdmin } from "./http.js";

const at = qs => new URL(`https://x/y${qs}`);

// Absent or blank falls back; a value inside the range is taken as given.
assert.equal(parseLimit(at(""), 10, 50), 10);
assert.equal(parseLimit(at("?limit="), 10, 50), 10);
assert.equal(parseLimit(at("?limit=  "), 10, 50), 10);
assert.equal(parseLimit(at("?limit=25"), 10, 50), 25);

// Over the cap clamps. Under 1, non-integer, or not a number at all is a
// caller error (null, which every handler turns into a 400) rather than a
// silent fallback — a typo'd limit that quietly returns the default is how
// you end up debugging the wrong thing.
assert.equal(parseLimit(at("?limit=9999"), 10, 50), 50);
assert.equal(parseLimit(at("?limit=-1"), 10, 50), null);
assert.equal(parseLimit(at("?limit=0"), 10, 50), null);
assert.equal(parseLimit(at("?limit=1.5"), 10, 50), null);
assert.equal(parseLimit(at("?limit=abc"), 10, 50), null);
assert.equal(parseLimit(at("?limit=Infinity"), 10, 50), null);

// --- requireAdmin ---

const req = auth => new Request("https://x/y", { headers: auth ? { Authorization: auth } : {} });

assert.equal(requireAdmin(req("Bearer s3cret"), { ADMIN_SECRET: "s3cret" }), null, "correct token passes");

{
  const res = requireAdmin(req("Bearer wrong"), { ADMIN_SECRET: "s3cret" });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "Unauthorized" });
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*", "401s carry CORS like every other response");
}

// No header at all is the same 401, not a crash on a null Authorization.
assert.equal((await requireAdmin(req(null), { ADMIN_SECRET: "s3cret" })).status, 401);

{
  // Unset secret used to compare against the literal "Bearer undefined",
  // which anyone could send. Missing config now degrades to a clear 501 for
  // that endpoint instead of quietly authenticating a stranger.
  const res = requireAdmin(req("Bearer undefined"), {});
  assert.equal(res.status, 501);
  assert.deepEqual(await res.json(), { error: "ADMIN_SECRET not configured" });
}

// json() itself: CORS on every response, including errors.
{
  const res = json({ ok: true });
  assert.equal(res.headers.get("Content-Type"), "application/json");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
}

console.log("http: ok");
