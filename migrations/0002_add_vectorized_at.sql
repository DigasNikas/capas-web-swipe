-- Tracks whether a cover has actually been embedded into Vectorize,
-- replacing the "does analytics_covers have a row" proxy handleSwipe's
-- first-vote check still uses for a different purpose (deciding whether to
-- fire the dispatch at all, not whether embedding is actually done).
--
-- Backfill: every cover that already has a crowd vote was, as far as this
-- migration can tell, already embedded by one mechanism or another (the
-- old weekly full-rebuild before it was removed, or a cover-first-vote
-- dispatch that already ran). It's marked done now, rather than left to
-- look like a fresh candidate the moment /vectorize-candidates goes live.
-- This is an assumption, not a guarantee: a cover whose image download
-- failed during some past run (build_vectorize_index.py's own "skipped
-- (download failures)" case) would wrongly get marked done here too.
-- Accepted gap, same shape as the one this whole migration exists to fix.
-- Rerun scripts/build_vectorize_index.py --limit N by hand afterward if a
-- spot-check on capas-cover-embeddings' vector count against this table
-- ever shows a mismatch.
ALTER TABLE covers ADD COLUMN vectorized_at TEXT;
UPDATE covers SET vectorized_at = datetime('now') WHERE id IN (SELECT cover_id FROM analytics_covers);
