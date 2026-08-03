-- The unique index restaurant_image_source_url_uidx is declared in
-- 001_initial_schema.sql, but databases created before it was added to that
-- file never received it, so ON CONFLICT DO NOTHING could not collapse
-- repeated photos. Re-apply the dedupe and recreate the index idempotently.

BEGIN;

-- Step 1: collapse duplicates that arrived since the index went missing.
WITH normalized AS (
  SELECT id,
         restaurant_id,
         COALESCE(restaurant_source_id, '00000000-0000-0000-0000-000000000000'::uuid) AS src_id,
         CASE WHEN url LIKE '%googleusercontent.com%'
              THEN regexp_replace(url, '=w[0-9]+(-h[0-9]+)?(-[a-z0-9]+)*$', '', 'i')
              ELSE url
         END AS base_url,
         is_cover,
         sort_order
  FROM restaurant_image
),
ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY restaurant_id, src_id, base_url
           ORDER BY is_cover DESC, sort_order ASC, id ASC
         ) AS rn
  FROM normalized
)
DELETE FROM restaurant_image ri
USING ranked r
WHERE ri.id = r.id AND r.rn > 1;

-- Step 2: normalize surviving Google CDN URLs to their shared base URL.
UPDATE restaurant_image ri
SET url = b.base_url
FROM (
  SELECT id,
         CASE WHEN url LIKE '%googleusercontent.com%'
              THEN regexp_replace(url, '=w[0-9]+(-h[0-9]+)?(-[a-z0-9]+)*$', '', 'i')
              ELSE url
         END AS base_url
  FROM restaurant_image
) b
WHERE ri.id = b.id
  AND ri.url <> b.base_url;

-- Step 3: guarantee the unique index exists so future crawls are idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_image_source_url_uidx
  ON restaurant_image (
    restaurant_id,
    COALESCE(restaurant_source_id, '00000000-0000-0000-0000-000000000000'::uuid),
    url
  );

COMMIT;
