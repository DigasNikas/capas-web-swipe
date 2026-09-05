-- How a cover's ai_club was decided: 'model' for a Llama4 call, 'consensus'
-- for the fast path that skips the model when the RAG neighbours agree
-- strongly enough (see api/lib/ai.js's CONSENSUS_MIN and rag.md).
--
-- An explicit column rather than inferring it from ai_headline being empty:
-- inference here has an edge case immediately, since the model itself can
-- return a reply with no HEADLINE: line, and those rows would then read as
-- consensus labels forever.
--
-- Backfill: every existing ai_club came from a model call, since the fast
-- path did not exist when they were written. Rows with no label stay NULL on
-- both columns.
ALTER TABLE covers ADD COLUMN ai_source TEXT;
UPDATE covers SET ai_source = 'model' WHERE ai_club IS NOT NULL;
