-- Map common English menu spellings to the Vietnamese canonical dish without
-- changing the restaurant's original menu text.
BEGIN;

INSERT INTO canonical_dish_alias (canonical_dish_id, alias, normalized_alias, source, confidence)
SELECT cd.id, v.alias, v.normalized_alias, 'curated_bilingual_alias:v1', 0.98
FROM canonical_dish cd
JOIN (VALUES
  ('pho bo', 'Beef pho', 'beef pho'),
  ('pho bo', 'Beef brisket pho', 'beef brisket pho'),
  ('pho bo', 'Beef brisket & tendon pho', 'beef brisket tendon pho'),
  ('pho bo', 'Rare beef pho', 'rare beef pho'),
  ('pho bo', 'Rare beef & brisket pho', 'rare beef brisket pho'),
  ('pho bo', 'Rare beef, brisket & tendon pho', 'rare beef brisket tendon pho'),
  ('pho bo', 'Dry beef pho', 'dry beef pho'),
  ('pho ga', 'Chicken pho', 'chicken pho'),
  ('pho ga', 'Poached chicken pho', 'poached chicken pho')
) AS v(canonical_name, alias, normalized_alias)
  ON cd.normalized_name = v.canonical_name
ON CONFLICT (normalized_alias) DO UPDATE SET
  canonical_dish_id = EXCLUDED.canonical_dish_id,
  alias = EXCLUDED.alias,
  source = EXCLUDED.source,
  confidence = EXCLUDED.confidence;

CREATE OR REPLACE FUNCTION sync_canonical_dish_for_row()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_normalized text;
  v_canonical_id uuid;
BEGIN
  v_normalized := normalize_food_name(NEW.name);
  IF v_normalized = '' THEN
    NEW.canonical_dish_id := NULL;
    RETURN NEW;
  END IF;

  SELECT canonical_dish_id INTO v_canonical_id
  FROM canonical_dish_alias
  WHERE normalized_alias = v_normalized
  LIMIT 1;

  IF v_canonical_id IS NOT NULL THEN
    NEW.canonical_dish_id := v_canonical_id;
    RETURN NEW;
  END IF;

  INSERT INTO canonical_dish (canonical_name, normalized_name)
  VALUES (trim(NEW.name), v_normalized)
  ON CONFLICT (normalized_name) DO NOTHING;

  SELECT id INTO v_canonical_id
  FROM canonical_dish
  WHERE normalized_name = v_normalized;

  NEW.canonical_dish_id := v_canonical_id;
  RETURN NEW;
END;
$$;

UPDATE dish d
SET canonical_dish_id = cda.canonical_dish_id
FROM canonical_dish_alias cda
WHERE normalize_food_name(d.name) = cda.normalized_alias
  AND d.canonical_dish_id IS DISTINCT FROM cda.canonical_dish_id;

COMMIT;
