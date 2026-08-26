CREATE TABLE IF NOT EXISTS covers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  newspaper  TEXT NOT NULL,           -- 'record', 'abola', 'ojogo'
  date       TEXT NOT NULL,           -- 'YYYY-MM-DD'
  r2_key     TEXT NOT NULL,           -- '2026/04/25/record_2026-04-25.jpg'
  url        TEXT NOT NULL,           -- full public URL
  thumb_url  TEXT,                    -- generated 220px WebP thumbnail (nullable, backfilled)
  ai_club    TEXT,                    -- zero-shot model guess (nullable, backfilled): ALTER TABLE covers ADD COLUMN ai_club TEXT
  ai_headline TEXT,                   -- headline the model quoted back, so a wrong guess is debuggable: ALTER TABLE covers ADD COLUMN ai_headline TEXT
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
-- this is the only table the public dashboard's API is allowed to read.
CREATE TABLE IF NOT EXISTS analytics_covers (
  cover_id    INTEGER PRIMARY KEY REFERENCES covers(id),
  newspaper   TEXT NOT NULL,
  date        TEXT NOT NULL,
  club        TEXT NOT NULL,           -- winning decision for this cover
  votes_club  INTEGER NOT NULL,
  votes_total INTEGER NOT NULL,
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- Dashboard comments, scoped to a single cover day. Reads always filter on
-- the newest date in analytics_covers, so a comment stops being reachable the
-- moment tomorrow's covers land. No separate email column, but `author`
-- embeds the email's local-part (below) — a comment is correlatable to an
-- app account, by design, matching the identifier the leaderboard shows.
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,            -- 'YYYY-MM-DD', the cover day
  author     TEXT NOT NULL,            -- "Given - localpart", e.g. "Diogo - dlimanic"
  author_sub TEXT NOT NULL,            -- opaque Google subject id, for rate limits
  body       TEXT NOT NULL,            -- <= 240 chars, plain text
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_date ON comments(date, created_at);
