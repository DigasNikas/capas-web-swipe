/**
 * Self-check: node api/handlers/search.test.mjs
 */
import assert from "node:assert";
import { handleSearch, buildFtsQuery } from "./search.js";

// buildFtsQuery: quoting each term neutralizes FTS5 special syntax
// characters (*, -, :, (, ), etc.) that a typed sentence could otherwise
// trip over, and turns space-separated terms into an implicit AND.
assert.strictEqual(buildFtsQuery("porto derby"), '"porto" "derby"');
assert.strictEqual(buildFtsQuery("  extra   spaces  "), '"extra" "spaces"');
assert.strictEqual(buildFtsQuery('quote " inside'), '"quote" """" "inside"');
assert.strictEqual(buildFtsQuery(""), "", "empty query -> empty FTS query, never a MATCH ''");
assert.strictEqual(buildFtsQuery("   "), "", "whitespace-only -> empty");
assert.strictEqual(
  buildFtsQuery(Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ")).split(" ").length,
  12,
  "capped at 12 terms",
);

// handleSearch: fake D1, routed on SQL text — same convention as
// comments.test.mjs/backfill-headlines.test.mjs.
function fakeEnv({ total = 1821, searchable = 1438, rows = [] } = {}) {
  const DB = {
    prepare(sql) {
      const stmt = {
        bind: (...args) => ((stmt.args = args), stmt),
        async all() {
          if (sql.includes("COUNT(*)")) return { results: [{ total, searchable }] };
          if (sql.includes("MATCH")) return { results: rows };
          throw new Error(`unexpected query: ${sql}`);
        },
      };
      return stmt;
    },
  };
  return { DB };
}

const req = (qs) => new Request(`https://x/search${qs}`);

// No query: still reports coverage, skips the MATCH query entirely (an
// empty FTS5 MATCH string is invalid syntax, not just "no results").
{
  const env = fakeEnv();
  const res = await handleSearch(req(""), env, new URL(req("").url));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body, { results: [], total: 1821, searchable: 1438 });
}

// A real query hits MATCH and returns whatever D1 gives back, alongside
// the same coverage numbers.
{
  const rows = [{ id: 1, newspaper: "record", date: "2026-08-30", headlines: "Palhinha já é da casa" }];
  const env = fakeEnv({ rows });
  const url = new URL("https://x/search?q=palhinha");
  const res = await handleSearch(new Request(url), env, url);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body, { results: rows, total: 1821, searchable: 1438 });
}

console.log("ok");
