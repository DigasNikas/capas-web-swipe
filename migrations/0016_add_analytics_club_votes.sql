-- Votes per club on each cover, not just the winner's. "Posse de bola
-- dividida" needs the whole split to draw a cover's bar, and the winner's
-- count alone cannot say whether the rest went to one rival or scattered.
--
-- On analytics_covers rather than read from swipes: that table is the only one
-- the public API is allowed to touch, and these are counts with no user
-- attached, like the two columns already here.
--
-- Defaulted to 0 and backfilled from swipes in the same run, so a row written
-- before this migration is not mistaken for a cover nobody voted for.
ALTER TABLE analytics_covers ADD COLUMN votes_benfica  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analytics_covers ADD COLUMN votes_sporting INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analytics_covers ADD COLUMN votes_porto    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analytics_covers ADD COLUMN votes_others   INTEGER NOT NULL DEFAULT 0;

UPDATE analytics_covers SET
  votes_benfica  = (SELECT COUNT(*) FROM swipes WHERE cover_id = analytics_covers.cover_id AND decision = 'benfica'),
  votes_sporting = (SELECT COUNT(*) FROM swipes WHERE cover_id = analytics_covers.cover_id AND decision = 'sporting'),
  votes_porto    = (SELECT COUNT(*) FROM swipes WHERE cover_id = analytics_covers.cover_id AND decision = 'porto'),
  votes_others   = (SELECT COUNT(*) FROM swipes WHERE cover_id = analytics_covers.cover_id AND decision = 'others');
