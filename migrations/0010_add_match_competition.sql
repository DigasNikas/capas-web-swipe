-- Which competition a match belonged to, so the calendar's 🚨 can say why
-- ignoring that club was unfair: "Porto foi o único a jogar Champions League
-- ontem". scripts/import_matches.py fills it and now updates rows it already
-- inserted, so a re-import of a season backfills it. Older rows stay NULL and
-- the alert simply drops the competition from the sentence.
ALTER TABLE matches ADD COLUMN competition TEXT;
