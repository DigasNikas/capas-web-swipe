CREATE TABLE IF NOT EXISTS covers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  newspaper  TEXT NOT NULL,           -- 'record', 'abola', 'ojogo'
  date       TEXT NOT NULL,           -- 'YYYY-MM-DD'
  r2_key     TEXT NOT NULL,           -- '2026/04/25/record_2026-04-25.jpg'
  url        TEXT NOT NULL,           -- full public URL
  thumb_url  TEXT,                    -- generated 220px WebP thumbnail (nullable, backfilled)
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (newspaper, date)
);

CREATE TABLE IF NOT EXISTS swipes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email  TEXT NOT NULL,
  cover_id    INTEGER NOT NULL REFERENCES covers(id),
  decision    TEXT NOT NULL,           -- 'sporting', 'benfica', 'porto', 'others'
  is_favorite INTEGER NOT NULL DEFAULT 0,  -- personal bookmark, unrelated to 'decision'
  swiped_at   TEXT DEFAULT (datetime('now')),
  UNIQUE (user_email, cover_id)       -- one record per user per cover; re-swipes update it
);

CREATE VIEW IF NOT EXISTS users AS
  SELECT
    user_email                          AS email,
    MIN(swiped_at)                      AS first_swipe_at,
    MAX(swiped_at)                      AS last_swipe_at,
    COUNT(*)                            AS swipe_count
  FROM swipes
  GROUP BY user_email;

CREATE TABLE IF NOT EXISTS matches (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  club       TEXT NOT NULL,            -- 'sporting', 'benfica', 'porto'
  match_date TEXT NOT NULL,            -- 'YYYY-MM-DD'
  UNIQUE (club, match_date)
);

-- Public results, derived from swipes. Never joined with user_email —
-- this is the only table the public landing page's API is allowed to read.
CREATE TABLE IF NOT EXISTS analytics_covers (
  cover_id    INTEGER PRIMARY KEY REFERENCES covers(id),
  newspaper   TEXT NOT NULL,
  date        TEXT NOT NULL,
  club        TEXT NOT NULL,           -- winning decision for this cover
  votes_club  INTEGER NOT NULL,
  votes_total INTEGER NOT NULL,
  updated_at  TEXT DEFAULT (datetime('now'))
);
