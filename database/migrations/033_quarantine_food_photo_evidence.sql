-- Quarantine dishes created from the old food-photo classifier bug.
-- Keep the rows and evidence for audit/recovery; make them unavailable so they
-- cannot participate in search or recommendation until a real menu confirms
-- them.
BEGIN;

UPDATE dish d
SET status = 'unavailable', confidence = LEAST(COALESCE(d.confidence, 0), 0.1)
WHERE d.source = 'menu_image:vision:v1'
  AND d.status = 'available'
  AND EXISTS (
    SELECT 1
    FROM dish_evidence de
    JOIN menu_image_extraction mie
      ON mie.restaurant_image_id = de.restaurant_image_id
    WHERE de.dish_id = d.id
      AND de.evidence_type = 'menu_image'
      AND mie.status = 'completed'
      AND COALESCE(mie.raw_ocr_text, '') ILIKE 'food_photo:%'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM dish_evidence de
    JOIN menu_image_extraction mie
      ON mie.restaurant_image_id = de.restaurant_image_id
    WHERE de.dish_id = d.id
      AND de.evidence_type = 'menu_image'
      AND mie.status = 'completed'
      AND COALESCE(mie.raw_ocr_text, '') NOT ILIKE 'food_photo:%'
  );

COMMIT;
