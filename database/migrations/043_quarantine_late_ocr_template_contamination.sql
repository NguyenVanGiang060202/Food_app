-- Migrations 039-041 ran before later OCR batches were imported. Re-apply the
-- same precision rule to those late rows and quarantine mixed template output
-- so a generic photo cannot become an exact-dish recommendation.
BEGIN;

WITH suspicious AS (
  SELECT restaurant_image_id
  FROM menu_image_extraction
  WHERE status = 'completed'
    AND model <> 'website:menu:v1'
    AND (
      regexp_count(lower(unaccent(COALESCE(raw_ocr_text, ''))), '(bun bo hue|com tam|banh mi) - ') >= 2
      OR (
        regexp_count(lower(unaccent(COALESCE(raw_ocr_text, ''))), '(bun bo hue|com tam|banh mi) - ') = 1
        AND lower(COALESCE(raw_ocr_text, '')) LIKE '% - none%'
      )
    )
),
marked AS (
  UPDATE menu_image_extraction mie
  SET status = 'not_menu',
      error_message = 'quarantined: late OCR template contamination',
      updated_at = now()
  FROM suspicious s
  WHERE mie.restaurant_image_id = s.restaurant_image_id
  RETURNING mie.restaurant_image_id
)
UPDATE dish d
SET status = 'unavailable',
    confidence = LEAST(COALESCE(d.confidence, 0), 0.1)
WHERE d.status = 'available'
  AND EXISTS (
    SELECT 1
    FROM dish_evidence de
    JOIN marked m ON m.restaurant_image_id = de.restaurant_image_id
    WHERE de.dish_id = d.id AND de.evidence_type = 'menu_image'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM dish_evidence clean_de
    JOIN menu_image_extraction clean_mie
      ON clean_mie.restaurant_image_id = clean_de.restaurant_image_id
    WHERE clean_de.dish_id = d.id
      AND clean_de.evidence_type = 'menu_image'
      AND clean_mie.status = 'completed'
      AND clean_mie.model = 'website:menu:v1'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM dish_evidence clean_de
    JOIN menu_image_extraction clean_mie
      ON clean_mie.restaurant_image_id = clean_de.restaurant_image_id
    WHERE clean_de.dish_id = d.id
      AND clean_de.evidence_type = 'menu_image'
      AND clean_mie.status = 'completed'
      AND clean_mie.model <> 'website:menu:v1'
      AND COALESCE(clean_mie.raw_ocr_text, '') NOT ILIKE 'food_photo:%'
      AND clean_mie.error_message IS DISTINCT FROM 'quarantined: late OCR template contamination'
  );

COMMIT;
