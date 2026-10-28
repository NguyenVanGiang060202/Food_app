-- Normalize Vietnamese dish identities consistently across OCR, curation and
-- website ingestion. NFD removes combining accents but does not decompose
-- Vietnamese đ/Đ, so older pipelines could create rows such as "ặc biệt" and
-- "Đặc biệt" for the same menu item. Merge those rows without dropping any
-- evidence, attributes or review links.
BEGIN;

CREATE TEMP TABLE dish_duplicate_map (
  duplicate_id uuid PRIMARY KEY,
  keeper_id uuid NOT NULL,
  restaurant_id uuid NOT NULL
) ON COMMIT DROP;

WITH normalized AS (
  SELECT d.id,
         d.restaurant_id,
         trim(regexp_replace(lower(unaccent(d.name)), '[^a-z0-9]+', ' ', 'g')) AS normalized_name,
         d.status,
         d.source,
         d.confidence,
         count(DISTINCT de.id) AS evidence_count
  FROM dish d
  LEFT JOIN dish_evidence de ON de.dish_id = d.id
  GROUP BY d.id
), ranked AS (
  SELECT n.*,
         first_value(n.id) OVER (
           PARTITION BY n.restaurant_id, n.normalized_name
           ORDER BY
             (n.status = 'available') DESC,
             (n.source IN ('website:menu:v1', 'menu_image:curated')) DESC,
             n.evidence_count DESC,
             COALESCE(n.confidence, 0) DESC,
             n.id
         ) AS keeper_id,
         count(*) OVER (PARTITION BY n.restaurant_id, n.normalized_name) AS duplicate_count
  FROM normalized n
)
INSERT INTO dish_duplicate_map (duplicate_id, keeper_id, restaurant_id)
SELECT id, keeper_id, restaurant_id
FROM ranked
WHERE duplicate_count > 1 AND id <> keeper_id;

-- Move evidence first. The unique key is per dish/image/type, so duplicate
-- rows can safely collapse onto the keeper with the strongest evidence.
INSERT INTO dish_evidence (dish_id, restaurant_image_id, evidence_type, raw_name, raw_price, confidence, verified_at)
SELECT m.keeper_id,
       de.restaurant_image_id,
       de.evidence_type,
       de.raw_name,
       de.raw_price,
       de.confidence,
       de.verified_at
FROM dish_duplicate_map m
JOIN dish_evidence de ON de.dish_id = m.duplicate_id
ON CONFLICT (dish_id, restaurant_image_id, evidence_type) DO UPDATE SET
  raw_name = COALESCE(dish_evidence.raw_name, EXCLUDED.raw_name),
  raw_price = COALESCE(dish_evidence.raw_price, EXCLUDED.raw_price),
  confidence = GREATEST(dish_evidence.confidence, EXCLUDED.confidence),
  verified_at = GREATEST(dish_evidence.verified_at, EXCLUDED.verified_at);

DELETE FROM dish_evidence de
USING dish_duplicate_map m
WHERE de.dish_id = m.duplicate_id;

-- Preserve food attributes and the strongest confidence when two exact rows
-- had been enriched independently.
INSERT INTO dish_attribute (dish_id, attribute_id, source, confidence)
SELECT m.keeper_id, da.attribute_id, da.source, da.confidence
FROM dish_duplicate_map m
JOIN dish_attribute da ON da.dish_id = m.duplicate_id
ON CONFLICT (dish_id, attribute_id) DO UPDATE SET
  source = COALESCE(dish_attribute.source, EXCLUDED.source),
  confidence = GREATEST(COALESCE(dish_attribute.confidence, 0), COALESCE(EXCLUDED.confidence, 0));

DELETE FROM dish_attribute da
USING dish_duplicate_map m
WHERE da.dish_id = m.duplicate_id;

UPDATE review_opinion ro
SET dish_id = m.keeper_id
FROM dish_duplicate_map m
WHERE ro.dish_id = m.duplicate_id;

-- Prefer the trusted canonical identity if the keeper did not have one yet.
UPDATE dish keeper
SET canonical_dish_id = COALESCE(
      keeper.canonical_dish_id,
      (SELECT duplicate.canonical_dish_id
       FROM dish duplicate
       JOIN dish_duplicate_map m ON m.duplicate_id = duplicate.id
       WHERE m.keeper_id = keeper.id
         AND duplicate.canonical_dish_id IS NOT NULL
       ORDER BY duplicate.id
       LIMIT 1)
    )
WHERE keeper.id IN (SELECT keeper_id FROM dish_duplicate_map);

DELETE FROM dish d
USING dish_duplicate_map m
WHERE d.id = m.duplicate_id;

-- Re-write every remaining normalized identity using PostgreSQL's Unicode-aware
-- unaccent implementation, which handles both đ and Đ.
UPDATE dish
SET normalized_name = trim(regexp_replace(lower(unaccent(name)), '[^a-z0-9]+', ' ', 'g'))
WHERE normalized_name IS DISTINCT FROM trim(regexp_replace(lower(unaccent(name)), '[^a-z0-9]+', ' ', 'g'));

-- Derived profiles/embeddings must be regenerated after their dish documents
-- change. The source facts remain intact.
UPDATE restaurant_food_profile fp
SET status = 'stale', invalidated_at = now(), updated_at = now()
WHERE fp.restaurant_id IN (
  SELECT DISTINCT restaurant_id FROM dish_duplicate_map
);

UPDATE restaurant r
SET semantic_profile = NULL, updated_at = now()
WHERE r.id IN (SELECT DISTINCT restaurant_id FROM dish_duplicate_map);

COMMIT;
