-- The first OCR quarantine only caught the three-row template. Some bad
-- extractions contain two stock rows (for example bun bo hue + com tam).
-- Quarantine those exact dish facts while preserving the raw evidence.
BEGIN;

UPDATE dish d
SET status = 'unavailable',
    confidence = LEAST(COALESCE(d.confidence, 0), 0.1)
WHERE d.status = 'available'
  AND d.normalized_name IN ('bun bo hue', 'com tam', 'banh mi')
  AND EXISTS (
    SELECT 1
    FROM dish_evidence de
    JOIN menu_image_extraction mie
      ON mie.restaurant_image_id = de.restaurant_image_id
    WHERE de.dish_id = d.id
      AND de.evidence_type = 'menu_image'
      AND mie.status = 'completed'
      AND (
        (CASE WHEN left(regexp_replace(lower(unaccent(COALESCE(mie.raw_ocr_text, ''))), '\s+', ' ', 'g'), 700) LIKE '%bun bo hue - %' THEN 1 ELSE 0 END)
        + (CASE WHEN left(regexp_replace(lower(unaccent(COALESCE(mie.raw_ocr_text, ''))), '\s+', ' ', 'g'), 700) LIKE '%com tam - %' THEN 1 ELSE 0 END)
        + (CASE WHEN left(regexp_replace(lower(unaccent(COALESCE(mie.raw_ocr_text, ''))), '\s+', ' ', 'g'), 700) LIKE '%banh mi - %' THEN 1 ELSE 0 END)
      ) >= 2
  )
  AND NOT EXISTS (
    SELECT 1
    FROM dish_evidence de
    JOIN menu_image_extraction mie
      ON mie.restaurant_image_id = de.restaurant_image_id
    WHERE de.dish_id = d.id
      AND de.evidence_type = 'menu_image'
      AND mie.status = 'completed'
      AND (
        (CASE WHEN left(regexp_replace(lower(unaccent(COALESCE(mie.raw_ocr_text, ''))), '\s+', ' ', 'g'), 700) LIKE '%bun bo hue - %' THEN 1 ELSE 0 END)
        + (CASE WHEN left(regexp_replace(lower(unaccent(COALESCE(mie.raw_ocr_text, ''))), '\s+', ' ', 'g'), 700) LIKE '%com tam - %' THEN 1 ELSE 0 END)
        + (CASE WHEN left(regexp_replace(lower(unaccent(COALESCE(mie.raw_ocr_text, ''))), '\s+', ' ', 'g'), 700) LIKE '%banh mi - %' THEN 1 ELSE 0 END)
      ) < 2
      AND COALESCE(mie.raw_ocr_text, '') NOT ILIKE 'food_photo:%'
  );

COMMIT;
