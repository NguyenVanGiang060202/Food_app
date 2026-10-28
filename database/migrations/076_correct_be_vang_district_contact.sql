-- The restaurant's official site identifies its 261-263 An Duong Vuong
-- location as former District 5 and gives the current Cho Quan ward and
-- 0938 261 263 hotline. The imported row was labeled District 3.
-- https://nhahangbevang.com/
WITH matched AS (
  SELECT r.id AS restaurant_id, l.id AS location_id
  FROM restaurant r
  JOIN location l ON l.id = r.location_id
  WHERE r.id = 'fce5f2ba-3362-4be1-9324-af17f0658a8c'
    AND r.name = 'Nhà Hàng Bê Vàng'
    AND r.website_url = 'http://nhahangbevang.com/'
    AND r.phone = '+84 28 3833 1322'
    AND l.id = '408c4df7-c500-427e-9212-60dd1d291f74'
    AND l.address_line = '261-263 An Dương Vương'
    AND l.district = 'Quận 3'
    AND ST_DWithin(
      l.coordinates,
      ST_SetSRID(ST_MakePoint(106.683028, 10.7608742), 4326)::geography,
      100
    )
    AND NOT EXISTS (
      SELECT 1 FROM restaurant other
      WHERE other.location_id = l.id AND other.id <> r.id
    )
), corrected_location AS (
  UPDATE location l
  SET ward = 'Chợ Quán',
      district = 'Quận 5',
      formatted_address = '261-263 An Dương Vương, Chợ Quán, Quận 5, Ho Chi Minh City',
      updated_at = now()
  FROM matched m
  WHERE l.id = m.location_id
  RETURNING l.id
)
UPDATE restaurant r
SET phone = '+84 938 261 263',
    updated_at = now()
FROM matched m
JOIN corrected_location cl ON cl.id = m.location_id
WHERE r.id = m.restaurant_id;
