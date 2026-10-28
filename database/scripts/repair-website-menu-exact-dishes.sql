BEGIN;

DO $$
DECLARE
  row_data RECORD;
  exact_name TEXT;
  exact_normalized TEXT;
  exact_dish_id UUID;
  existing_evidence_id UUID;
BEGIN
  FOR row_data IN
    SELECT de.id AS evidence_id,
           de.restaurant_image_id,
           de.evidence_type,
           de.raw_name,
           d.id AS old_dish_id,
           d.restaurant_id
    FROM dish_evidence de
    JOIN dish d ON d.id = de.dish_id
    JOIN menu_image_extraction mie ON mie.restaurant_image_id = de.restaurant_image_id
    WHERE de.evidence_type = 'menu_image'
      AND d.source = 'website:menu:v1'
      AND mie.model = 'website:menu:v1'
      AND de.raw_name IS NOT NULL
  LOOP
    exact_name := trim(regexp_replace(row_data.raw_name, '\s*[-–—:]\s*\d[\d.,]*\s*(k|000|₫|vnd)?\s*$', '', 1, 0, 'i'));
    exact_normalized := trim(regexp_replace(lower(unaccent(exact_name)), '[^a-z0-9]+', ' ', 'g'));
    IF length(exact_normalized) < 2 THEN
      CONTINUE;
    END IF;

    SELECT id INTO exact_dish_id
    FROM dish
    WHERE restaurant_id = row_data.restaurant_id
      AND normalized_name = exact_normalized
    ORDER BY id
    LIMIT 1;

    IF exact_dish_id IS NULL THEN
      INSERT INTO dish (restaurant_id, name, normalized_name, status, source, confidence)
      VALUES (row_data.restaurant_id, exact_name, exact_normalized, 'available', 'website:menu:v1', 0.95)
      RETURNING id INTO exact_dish_id;
    ELSE
      UPDATE dish
      SET name = exact_name,
          status = 'available',
          source = 'website:menu:v1',
          confidence = GREATEST(COALESCE(confidence, 0), 0.95)
      WHERE id = exact_dish_id;
    END IF;

    SELECT id INTO existing_evidence_id
    FROM dish_evidence
    WHERE dish_id = exact_dish_id
      AND restaurant_image_id = row_data.restaurant_image_id
      AND evidence_type = row_data.evidence_type
      AND id <> row_data.evidence_id
    ORDER BY id
    LIMIT 1;

    IF existing_evidence_id IS NOT NULL THEN
      UPDATE dish_evidence
      SET raw_name = COALESCE(raw_name, row_data.raw_name),
          confidence = GREATEST(COALESCE(confidence, 0), 0.95),
          verified_at = now()
      WHERE id = existing_evidence_id;
      DELETE FROM dish_evidence WHERE id = row_data.evidence_id;
    ELSE
      UPDATE dish_evidence
      SET dish_id = exact_dish_id
      WHERE id = row_data.evidence_id;
    END IF;

    existing_evidence_id := NULL;
  END LOOP;
END $$;

UPDATE dish d
SET status = 'unavailable', confidence = LEAST(COALESCE(d.confidence, 0), 0.1)
WHERE d.source = 'website:menu:v1'
  AND d.status = 'available'
  AND NOT EXISTS (
    SELECT 1 FROM dish_evidence de WHERE de.dish_id = d.id
  );

COMMIT;
