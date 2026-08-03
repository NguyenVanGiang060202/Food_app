-- Remove sources that are no longer part of the production crawler.
-- The canonical restaurant catalog is intentionally preserved; only source-
-- specific provenance and crawler-operation records are removed.
BEGIN;

CREATE TEMP TABLE inactive_source_ids ON COMMIT DROP AS
SELECT id
FROM data_source
WHERE code IN ('fixture', 'google_maps')
  AND is_active = false;

DELETE FROM processing_record pr
WHERE pr.crawl_run_id IN (
  SELECT cr.id
  FROM crawl_run cr
  JOIN inactive_source_ids s ON s.id = cr.data_source_id
)
OR pr.restaurant_source_id IN (
  SELECT rs.id
  FROM restaurant_source rs
  JOIN inactive_source_ids s ON s.id = rs.data_source_id
);

DELETE FROM review r
WHERE r.restaurant_source_id IN (
  SELECT rs.id
  FROM restaurant_source rs
  JOIN inactive_source_ids s ON s.id = rs.data_source_id
);

DELETE FROM restaurant_image ri
WHERE ri.restaurant_source_id IN (
  SELECT rs.id
  FROM restaurant_source rs
  JOIN inactive_source_ids s ON s.id = rs.data_source_id
);

DELETE FROM restaurant_source rs
USING inactive_source_ids s
WHERE rs.data_source_id = s.id;

DELETE FROM crawl_run cr
USING inactive_source_ids s
WHERE cr.data_source_id = s.id;

DELETE FROM data_source ds
USING inactive_source_ids s
WHERE ds.id = s.id;

COMMIT;