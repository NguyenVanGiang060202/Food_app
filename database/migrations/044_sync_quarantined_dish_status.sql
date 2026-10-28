-- Synchronize legacy dish rows after an extraction is quarantined. A dish is
-- unavailable when every menu evidence row is either not_menu/failed or a
-- food-photo classification. Keep it available when any clean completed menu
-- extraction (including first-party website evidence) remains.
BEGIN;

UPDATE dish d
SET status = 'unavailable',
    confidence = LEAST(COALESCE(d.confidence, 0), 0.1)
WHERE d.status = 'available'
  AND EXISTS (
    SELECT 1
    FROM dish_evidence de
    JOIN menu_image_extraction mie ON mie.restaurant_image_id = de.restaurant_image_id
    WHERE de.dish_id = d.id
      AND de.evidence_type = 'menu_image'
      AND (
        mie.status <> 'completed'
        OR COALESCE(mie.raw_ocr_text, '') ILIKE 'food_photo:%'
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM dish_evidence clean_de
    JOIN menu_image_extraction clean_mie ON clean_mie.restaurant_image_id = clean_de.restaurant_image_id
    WHERE clean_de.dish_id = d.id
      AND clean_de.evidence_type = 'menu_image'
      AND clean_mie.status = 'completed'
      AND COALESCE(clean_mie.raw_ocr_text, '') NOT ILIKE 'food_photo:%'
  );

COMMIT;
