-- OCR output with the same stock dish repeated many times is not a reliable
-- menu extraction. Keep the raw text for audit, but remove its dish facts from
-- recommendation until the image is reprocessed with a better extraction.
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
      AND mie.status = 'completed'
      AND COALESCE(mie.raw_ocr_text, '') NOT ILIKE 'food_photo:%'
      AND regexp_count(
        lower(unaccent(COALESCE(mie.raw_ocr_text, ''))),
        '(bun bo hue|com tam|banh mi) - '
      ) > 3
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
      AND regexp_count(
        lower(unaccent(COALESCE(mie.raw_ocr_text, ''))),
        '(bun bo hue|com tam|banh mi) - '
      ) <= 3
  );

COMMIT;
