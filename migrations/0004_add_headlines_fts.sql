-- Full-text search over covers.headlines. External-content FTS5: the
-- indexed text lives once, on covers itself, this table only holds the
-- inverted index (content='covers', content_rowid='id' — covers.id is
-- already the rowid, an INTEGER PRIMARY KEY). Kept in sync by triggers
-- rather than duplicated by hand on every write, so scrapeNewspaper's
-- insert, /update-headline's and /backfill-headlines's updates, and any
-- future write to headlines all stay searchable with no extra code path
-- to remember. See dashboard/documentation/search.md.
CREATE VIRTUAL TABLE covers_fts USING fts5(headlines, content='covers', content_rowid='id');

INSERT INTO covers_fts(rowid, headlines) SELECT id, headlines FROM covers;

CREATE TRIGGER covers_fts_ai AFTER INSERT ON covers BEGIN
  INSERT INTO covers_fts(rowid, headlines) VALUES (new.id, new.headlines);
END;

CREATE TRIGGER covers_fts_ad AFTER DELETE ON covers BEGIN
  INSERT INTO covers_fts(covers_fts, rowid, headlines) VALUES ('delete', old.id, old.headlines);
END;

CREATE TRIGGER covers_fts_au AFTER UPDATE ON covers BEGIN
  INSERT INTO covers_fts(covers_fts, rowid, headlines) VALUES ('delete', old.id, old.headlines);
  INSERT INTO covers_fts(rowid, headlines) VALUES (new.id, new.headlines);
END;
