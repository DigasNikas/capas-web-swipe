-- First migration tracked by wrangler d1 migrations. Everything before this
-- (the base schema.sql, plus ai_club/ai_headline/ai_why) is already live on
-- the production database, applied by hand before this mechanism existed.
-- Do not add migrations for those here, they'd fail against a database that
-- already has them.
ALTER TABLE covers ADD COLUMN ai_rag_covers TEXT;
