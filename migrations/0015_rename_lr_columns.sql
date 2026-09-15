-- Drop the ai_ prefix from the logistic regression's columns. The ai_ family
-- is the vision model's own output (ai_club, ai_owns, ai_why, ai_source); the
-- LR is a separate model over the stored embeddings, and naming its fields
-- ai_* implied they came from the same place. See api/lib/gate.js.
ALTER TABLE covers RENAME COLUMN ai_lr_benfica  TO lr_benfica;
ALTER TABLE covers RENAME COLUMN ai_lr_porto    TO lr_porto;
ALTER TABLE covers RENAME COLUMN ai_lr_sporting TO lr_sporting;
ALTER TABLE covers RENAME COLUMN ai_lr_others   TO lr_others;
ALTER TABLE covers RENAME COLUMN ai_lr_asof     TO lr_asof;
