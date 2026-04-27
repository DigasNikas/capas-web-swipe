CREATE TABLE IF NOT EXISTS capas (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  jornal     TEXT NOT NULL,           -- 'record', 'abola', 'ojogo'
  data       TEXT NOT NULL,           -- 'YYYY-MM-DD'
  r2_key     TEXT NOT NULL,           -- '2026/04/25/record_2026-04-25.jpg'
  url        TEXT NOT NULL,           -- full public URL
  criado_em  TEXT DEFAULT (datetime('now')),
  UNIQUE (jornal, data)
);
