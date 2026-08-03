-- Google Maps serves the same photo with different size suffixes
-- (e.g. ...=w86-h114-k-no vs ...=w80-h106-k-no), so the unique index on
-- restaurant_image (restaurant_id, restaurant_source_id, url) could not
-- collapse them. Collapse duplicates to the shared base URL and keep the
-- best row (cover first, then lowest sort_order, then earliest id).

BEGIN;

-- Step 1: remove duplicates, keeping one row per (restaurant, source, base URL).
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

-- Step 2: normalize surviving Google CDN URLs to their shared base URL so
-- future crawler runs hit the unique index instead of inserting again.
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

COMMIT;
