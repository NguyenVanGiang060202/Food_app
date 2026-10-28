-- Recommendation V3: indexes for exact and contextual menu-evidence lookups.
-- These are partial because unavailable dishes and non-menu evidence must never
-- participate in the public recommendation path.
BEGIN;

CREATE INDEX IF NOT EXISTS dish_available_restaurant_name_idx
  ON dish (restaurant_id, normalized_name)
  WHERE status = 'available';

CREATE INDEX IF NOT EXISTS dish_evidence_menu_image_lookup_idx
  ON dish_evidence (dish_id, restaurant_image_id)
  WHERE evidence_type = 'menu_image';

CREATE INDEX IF NOT EXISTS menu_image_extraction_trusted_lookup_idx
  ON menu_image_extraction (restaurant_image_id, extracted_at DESC)
  WHERE status = 'completed'
    AND model IN ('website:menu:v1', 'google_maps:menu-curated:v1');

COMMIT;
