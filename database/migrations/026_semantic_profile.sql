-- AI semantic-profile column.
--
-- The fixed category taxonomy is too coarse to express what a Vietnamese
-- restaurant really serves ("bún bò Huế cay, nước dùng ngọt, khách khen no
-- bụng"). This column holds an AI-written natural-language food profile per
-- restaurant (main dishes, flavor, texture/feel, portion, style). It becomes
-- the primary semantic document for embedding-based search so free-form user
-- chat can be matched without a category label. Category rows remain as a soft
-- signal only.

ALTER TABLE restaurant
  ADD COLUMN IF NOT EXISTS semantic_profile text;

COMMENT ON COLUMN restaurant.semantic_profile IS
  'AI-written natural-language food profile used as the semantic document for embedding-based search.';
