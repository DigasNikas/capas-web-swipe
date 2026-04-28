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
