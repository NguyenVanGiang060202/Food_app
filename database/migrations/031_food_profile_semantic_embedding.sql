-- Phase 3: deterministic semantic restaurant profile derived from persisted
-- Food Intelligence evidence. The embedding remains a rebuildable index.
BEGIN;

ALTER TABLE restaurant_food_profile
  ADD COLUMN IF NOT EXISTS semantic_text text,
  ADD COLUMN IF NOT EXISTS semantic_model text,
  ADD COLUMN IF NOT EXISTS semantic_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS restaurant_food_profile_semantic_status_idx
  ON restaurant_food_profile(status, semantic_updated_at);

COMMENT ON COLUMN restaurant_food_profile.semantic_text IS
  'Deterministic semantic document generated only from persisted food-profile evidence.';
COMMENT ON COLUMN restaurant_food_profile.semantic_model IS
  'Embedding model/version used for the semantic document; nullable until embedded.';

COMMIT;
