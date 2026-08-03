-- A Google Maps area card was ingested as a restaurant by the old crawler.
-- Keep provenance for audit, but exclude the invalid canonical record from search.
UPDATE restaurant_source rs
SET status = 'invalid', last_seen_at = now()
FROM data_source ds, restaurant r
WHERE rs.data_source_id = ds.id
  AND rs.restaurant_id = r.id
  AND ds.code = 'google_maps_playwright'
  AND lower(r.name) IN ('thành phố hồ chí minh', 'ho chi minh city');

UPDATE restaurant r
SET status = 'unknown', updated_at = now()
WHERE lower(r.name) IN ('thành phố hồ chí minh', 'ho chi minh city')
  AND NOT EXISTS (
    SELECT 1
    FROM restaurant_source rs
    WHERE rs.restaurant_id = r.id
      AND rs.status = 'active'
  );
