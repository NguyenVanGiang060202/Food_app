-- review_count must be NULL ("not observed") when no source exposes an
-- aggregate count. The previous schema used NOT NULL DEFAULT 0, so the
-- crawler stored 0 to mean "not observed", violating the data quality policy.
BEGIN;

ALTER TABLE restaurant
  ALTER COLUMN review_count DROP NOT NULL,
  ALTER COLUMN review_count DROP DEFAULT;

-- Backfill: restaurants whose active sources never reported an aggregate count
-- currently hold a fabricated 0. Set them to NULL. Keep real counts from
-- sources that did report one (e.g. fixture data).
UPDATE restaurant r
SET review_count = NULL, updated_at = now()
WHERE r.review_count = 0
  AND NOT EXISTS (
    SELECT 1
    FROM restaurant_source rs
    WHERE rs.restaurant_id = r.id
      AND rs.status = 'active'
      AND rs.source_review_count IS NOT NULL
  );

COMMIT;
