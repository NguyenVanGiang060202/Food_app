-- The chain's own store page places 6 Hong Ha by Tan Son Nhat airport in
-- Tan Binh, not District 12. Preserve the mapped point and change only this
-- unshared location when its current address and coordinates match.
UPDATE location l
SET district = 'Tân Bình',
    formatted_address = '6 Hồng Hà, Tân Bình, Ho Chi Minh City',
    updated_at = now()
FROM restaurant r
WHERE r.location_id = l.id
  AND r.website_url ILIKE '%dauhomemade.vn%'
  AND r.name ILIKE '%Đậu Homemade%'
  AND l.address_line = '6 Hồng Hà'
  AND l.district = 'Quận 12'
  AND ST_DWithin(
    l.coordinates,
    ST_SetSRID(ST_MakePoint(106.66652, 10.813229), 4326)::geography,
    100
  )
  AND NOT EXISTS (
    SELECT 1 FROM restaurant other WHERE other.location_id = l.id AND other.id <> r.id
  );
