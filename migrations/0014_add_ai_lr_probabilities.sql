-- Per-class probabilities from the logistic regression over the two Vectorize
-- embeddings (CLIP page layout + e5 lead headline), one column per class.
--
-- Recorded, not acted on, exactly like ai_owns: the label stays whatever
-- ai_club says. Writing all four rather than only P(others) costs four floats
-- and is the difference between answering one question and answering any
-- question asked later -- including the open one, whether a cover where the LR
-- and the model name *different clubs* is really a no-owner page.
--
-- Every value must be out-of-fold. The LR is fitted on crowd labels, so a
-- probability from a model that saw this cover in training reads ~95% right
-- and means nothing. ai_lr_asof records the training cutoff that produced the
-- row -- the walk-forward fold's boundary -- so an in-sample number can never
-- be mistaken for an honest one, and a later retrain is distinguishable from
-- the run that wrote the row.
--
-- NULL for covers with no headline vector: image-only recall on `others` is
-- 0.32, barely above guessing, so scoring them would add noise, not coverage.
-- Roughly 200 covers are permanently in that state (September and October 2025
-- have no headline block on capasjornais.pt at all).
ALTER TABLE covers ADD COLUMN ai_lr_benfica  REAL;
ALTER TABLE covers ADD COLUMN ai_lr_porto    REAL;
ALTER TABLE covers ADD COLUMN ai_lr_sporting REAL;
ALTER TABLE covers ADD COLUMN ai_lr_others   REAL;
ALTER TABLE covers ADD COLUMN ai_lr_asof     TEXT;
