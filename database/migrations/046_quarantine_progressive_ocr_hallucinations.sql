-- MiniCPM sometimes returns a progressive hallucination instead of a menu:
-- one dish is extended with "and ..." repeatedly, or dozens of `- none`
-- rows are emitted. Keep the extraction row for audit but remove its dish
-- facts from exact recommendation evidence.
BEGIN;

WITH suspicious AS (
  SELECT restaurant_image_id
  FROM menu_image_extraction
  WHERE status = 'completed'
    AND model LIKE 'minicpm-v%'
    AND (
      raw_ocr_text ILIKE '%the image shows%'
      OR raw_ocr_text ILIKE '%here is the information transcribed%'
      OR (
        regexp_count(lower(raw_ocr_text), '[-:]\\s*none\\b') >= 2
        AND regexp_count(lower(raw_ocr_text), '[-:]\\s*[0-9]') <= 2
      )
      OR (
        regexp_count(lower(raw_ocr_text), '(^|\\n)[^\\n]+[-:]') >= 5
        AND regexp_count(lower(raw_ocr_text), '(^|\\n)([^\\n]+) [-:]') >= 3
        AND length(raw_ocr_text) > 500
      )
    )
), marked AS (
  UPDATE menu_image_extraction mie
  SET status = 'not_menu',
      error_message = 'quarantined: progressive OCR hallucination',
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
      AND clean_mie.model LIKE 'minicpm-v%'
      AND clean_mie.error_message IS DISTINCT FROM 'quarantined: progressive OCR hallucination'
  );

COMMIT;
