-- A broken OCR/template path prepended the same fabricated menu rows to
-- unrelated restaurant images. Keep the evidence for audit, but quarantine
-- the resulting dish facts so exact-dish recommendation cannot trust them.
-- Two or more stock rows in one extraction identifies the contamination;
-- requiring all three missed bun+com and bun+banh-mi variants.
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
      AND NOT (
        (CASE WHEN left(regexp_replace(lower(unaccent(COALESCE(mie.raw_ocr_text, ''))), '\s+', ' ', 'g'), 700) LIKE '%bun bo hue - %' THEN 1 ELSE 0 END)
        + (CASE WHEN left(regexp_replace(lower(unaccent(COALESCE(mie.raw_ocr_text, ''))), '\s+', ' ', 'g'), 700) LIKE '%com tam - %' THEN 1 ELSE 0 END)
        + (CASE WHEN left(regexp_replace(lower(unaccent(COALESCE(mie.raw_ocr_text, ''))), '\s+', ' ', 'g'), 700) LIKE '%banh mi - %' THEN 1 ELSE 0 END)
      ) >= 2
      AND COALESCE(mie.raw_ocr_text, '') NOT ILIKE 'food_photo:%'
  );

COMMIT;
