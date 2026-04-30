CREATE TABLE IF NOT EXISTS covers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  newspaper  TEXT NOT NULL,           -- 'record', 'abola', 'ojogo'
  date       TEXT NOT NULL,           -- 'YYYY-MM-DD'
  r2_key     TEXT NOT NULL,           -- '2026/04/25/record_2026-04-25.jpg'
  url        TEXT NOT NULL,           -- full public URL
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (newspaper, date)
);

CREATE TABLE IF NOT EXISTS swipes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  cover_id   INTEGER NOT NULL REFERENCES covers(id),
  decision   TEXT NOT NULL,           -- 'sporting', 'benfica', 'porto', 'others'
  swiped_at  TEXT DEFAULT (datetime('now')),
  UNIQUE (user_email, cover_id)       -- one record per user per cover; re-swipes update it
);

CREATE TABLE IF NOT EXISTS clubs (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE            -- matches swipe decision values
);

INSERT OR IGNORE INTO clubs (name, slug) VALUES
  ('Sporting CP', 'sporting'),
  ('SL Benfica',  'benfica'),
  ('FC Porto',    'porto');

CREATE TABLE IF NOT EXISTS matches (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id    INTEGER NOT NULL REFERENCES clubs(id),
  match_date TEXT NOT NULL,            -- 'YYYY-MM-DD'
  UNIQUE (club_id, match_date)
);
