-- A vision response can contain dish-looking rows even when the image was
-- classified as food_photo/other. Those rows are audit data, not purchasable
-- menu facts. Keep them for traceability, but remove them from availability
-- unless the same dish also has a trusted menu source.
BEGIN;

UPDATE dish d
SET status = 'unavailable',
    confidence = LEAST(COALESCE(d.confidence, 0), 0.1)
WHERE d.status = 'available'
  AND EXISTS (
    SELECT 1
    FROM dish_evidence de
    JOIN menu_image_extraction mie
      ON mie.restaurant_image_id = de.restaurant_image_id
    WHERE de.dish_id = d.id
      AND de.evidence_type = 'menu_image'
      AND mie.status <> 'completed'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM dish_evidence trusted_de
    JOIN menu_image_extraction trusted_mie
      ON trusted_mie.restaurant_image_id = trusted_de.restaurant_image_id
    WHERE trusted_de.dish_id = d.id
      AND trusted_de.evidence_type = 'menu_image'
      AND trusted_mie.status = 'completed'
      AND trusted_mie.model IN ('website:menu:v1', 'google_maps:menu-curated:v1')
  );

COMMIT;
