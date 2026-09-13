-- Clear every AI verdict so the archive is re-classified with match-context
-- retrieval (scripts/rag_classify.py's match_bucket): neighbours now come
-- from covers sitting the same distance from a match, and the consensus fast
-- path only counts those. Old verdicts were produced against a different set
-- of neighbours, so keeping them would mix two pipelines in one agreement
-- number.
--
-- Only the verdicts go. The embeddings (vectorized_at,
-- headline_vectorized_at) and the scraped headlines stay, so nothing has to
-- be re-embedded — /rag-candidates simply sees the whole archive as
-- unclassified again and rag-classify.yml works through it.
UPDATE covers SET
  ai_club       = NULL,
  ai_headline   = NULL,
  ai_why        = NULL,
  ai_rag_covers = NULL,
  ai_rag_source = NULL,
  ai_source     = NULL;
