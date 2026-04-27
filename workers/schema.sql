CREATE TABLE IF NOT EXISTS covers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  newspaper  TEXT NOT NULL,           -- 'record', 'abola', 'ojogo'
  date       TEXT NOT NULL,           -- 'YYYY-MM-DD'
  r2_key     TEXT NOT NULL,           -- '2026/04/25/record_2026-04-25.jpg'
  url        TEXT NOT NULL,           -- full public URL
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (newspaper, date)
);
