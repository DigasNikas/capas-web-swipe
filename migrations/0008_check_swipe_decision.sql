-- Restrict swipes.decision to the four clubs the app can send.
--
-- POST /swipes validated only that decision was non-empty, so any
-- Access-authenticated user could store an arbitrary label. On a cover with
-- one or two votes that label became the public analytics_covers.club, and
-- the dashboard, which looks every club up in its own colour table, threw on
-- it. The handler now checks an allow-list; this is the same rule at the
-- schema, for anything that writes to D1 without going through it.
--
-- SQLite can't add a CHECK to an existing column, so the table is rebuilt.
-- The copy is deliberately not filtered: if a bad value is already stored,
-- the INSERT fails the CHECK and the whole migration rolls back, rather than
-- quietly deleting someone's vote. Find and fix those rows first with
--   SELECT decision, COUNT(*) FROM swipes GROUP BY decision;
--
-- The users view reads swipes, and SQLite refuses to rename a table into a
-- name a broken view points at, so the view is dropped and recreated around
-- the swap. Nothing holds a foreign key to swipes.

DROP VIEW IF EXISTS users;

CREATE TABLE swipes_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email  TEXT NOT NULL,
  cover_id    INTEGER NOT NULL REFERENCES covers(id),
  decision    TEXT NOT NULL CHECK (decision IN ('sporting', 'benfica', 'porto', 'others')),
  is_favorite INTEGER NOT NULL DEFAULT 0,
  swiped_at   TEXT DEFAULT (datetime('now')),
  UNIQUE (user_email, cover_id)
);

INSERT INTO swipes_new (id, user_email, cover_id, decision, is_favorite, swiped_at)
  SELECT id, user_email, cover_id, decision, is_favorite, swiped_at FROM swipes;

DROP TABLE swipes;
ALTER TABLE swipes_new RENAME TO swipes;

CREATE VIEW users AS
  SELECT
    user_email                          AS email,
    MIN(swiped_at)                      AS first_swipe_at,
    MAX(swiped_at)                      AS last_swipe_at,
    COUNT(*)                            AS swipe_count
  FROM swipes
  GROUP BY user_email;
