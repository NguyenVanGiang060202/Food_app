-- Correct the first backfill for PostgreSQL regex escaping and recover
-- coordinates from URLs already stored by the Playwright source.
UPDATE location l
SET coordinates = ST_SetSRID(
  ST_MakePoint(
    (regexp_match(rs.source_url, '!4d(-?[0-9]+[.]?[0-9]*)'))[1]::double precision,
    (regexp_match(rs.source_url, '!3d(-?[0-9]+[.]?[0-9]*)'))[1]::double precision
  ),
  4326
)::geography,
updated_at = now()
FROM restaurant r
JOIN restaurant_source rs ON rs.restaurant_id = r.id
JOIN data_source ds ON ds.id = rs.data_source_id
WHERE r.location_id = l.id
  AND ds.code = 'google_maps_playwright'
  AND l.coordinates IS NULL
  AND rs.source_url ~ '!3d-?[0-9]+[.]?[0-9]*!4d-?[0-9]+[.]?[0-9]*';