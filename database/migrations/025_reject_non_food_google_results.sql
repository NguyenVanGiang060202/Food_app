-- Google Maps returned non-food businesses (hospital, dental clinic, medical
-- center, karaoke, market, farm, mall, convention/banquet venue) and junk
-- records (closed, unnamed, address-only, district card) as restaurants.
-- Keep provenance for audit, but exclude the invalid canonical records from
-- search. Coffee and drink shops are deliberately left untouched even when a
-- name also mentions spa/massage.

CREATE TEMP TABLE junk_restaurant_ids AS
SELECT r.id
FROM restaurant r
WHERE lower(unaccent(r.name)) ~ '^benh vien'
   OR lower(unaccent(r.name)) ~ '^nha khoa'
   OR lower(unaccent(r.name)) ~ '^trung tam y te'
   OR lower(unaccent(r.name)) ~ '^phong kham'
   OR lower(unaccent(r.name)) ~ '^karaoke'
   OR lower(unaccent(r.name)) ~ '^cho '
   OR lower(unaccent(r.name)) ~ '\mfarm\M'
   OR lower(unaccent(r.name)) ~ '\mtrang trai\M'
   OR lower(unaccent(r.name)) ~ '\mnong trai\M'
   OR lower(unaccent(r.name)) ~ '\mnong truong\M'
   OR lower(unaccent(r.name)) ~ '\mnong san\M'
   OR lower(unaccent(r.name)) ~ '^da dong cua'
   OR lower(unaccent(r.name)) ~ '\mkhong ten\M'
   OR lower(unaccent(r.name)) ~ '^go!'
   OR lower(unaccent(r.name)) ~ '^trung tam (hoi nghi|yen tiec|su kien)'
   OR lower(unaccent(r.name)) = 'nha be'
   OR (lower(unaccent(r.name)) ~ '^[0-9]'
       AND lower(unaccent(r.name)) LIKE '%, phuong %'
       AND lower(unaccent(r.name)) LIKE '%quan %'
       AND lower(unaccent(r.name)) LIKE '%thanh pho %');

UPDATE restaurant_source rs
SET status = 'invalid', last_seen_at = now()
FROM junk_restaurant_ids j, data_source ds
WHERE rs.restaurant_id = j.id
  AND rs.data_source_id = ds.id
  AND ds.code = 'google_maps_playwright'
  AND rs.status = 'active';

UPDATE restaurant r
SET status = 'unknown', updated_at = now()
WHERE r.id IN (SELECT id FROM junk_restaurant_ids)
  AND NOT EXISTS (
    SELECT 1
    FROM restaurant_source rs
    WHERE rs.restaurant_id = r.id
      AND rs.status = 'active'
  );