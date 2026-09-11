-- Every vote recomputes its cover's totals from swipes (api/handlers/swipes.js).
-- Without this, that lookup by cover_id scanned the whole table, twice.
CREATE INDEX IF NOT EXISTS idx_swipes_cover_id ON swipes(cover_id);
