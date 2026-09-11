/**
 * Test-only: a D1 binding backed by node:sqlite, so self-checks run the real
 * SQL against the real schema instead of a stub that routes on query text.
 * Nothing under api/index.js imports this, so it never reaches the bundle.
 *
 * Covers the subset of the D1 API the handlers use: prepare().bind() with
 * first()/all()/run(), and batch(), which D1 runs as one transaction.
 *
 * `between` is the hook the race checks are built on. It's awaited after the
 * n-th round-trip this binding makes (a batch counts as one, since D1 commits
 * it atomically), which is exactly where another request's queries could land
 * in production. Running a whole second request there reproduces an
 * interleaving deterministically instead of hoping Promise.all produces one.
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = new URL("../schema.sql", import.meta.url);

export function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(SCHEMA, "utf8"));
  return db;
}

export function sqliteD1(db, { between } = {}) {
  let trips = 0;
  const roundTrip = async work => {
    const out = work();
    await between?.(trips++);
    return out;
  };

  const statement = (sql, args = []) => ({
    sql,
    args,
    bind: (...next) => statement(sql, next),
    first: () => roundTrip(() => db.prepare(sql).get(...args) ?? null),
    all: () => roundTrip(() => ({ results: db.prepare(sql).all(...args), success: true })),
    run: () => roundTrip(() => ({ meta: db.prepare(sql).run(...args), success: true })),
  });

  return {
    prepare: sql => statement(sql),
    batch: stmts => roundTrip(() => {
      db.exec("BEGIN");
      try {
        const out = stmts.map(s => ({ results: db.prepare(s.sql).all(...s.args), success: true }));
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    }),
  };
}
