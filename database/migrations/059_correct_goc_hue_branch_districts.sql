-- The first-party branch list identifies these exact three addresses in
-- Districts 5, 3 and 1. Their stored coordinates already match those areas;
-- only the district label/formatted address were incorrectly set to Q12.
WITH reviewed(restaurant_id, street, district, lon, lat) AS (
  VALUES
    ('5ca7cb5f-ce50-41c7-ba24-41cd7dfb885b'::uuid, '400 An Dương Vương', 'Quận 5', 106.6780769, 10.7593416),
    ('df7b18c6-4176-48a0-852e-09f378fb8102'::uuid, '41 Đ. Kỳ Đồng', 'Quận 3', 106.6812148, 10.7804676),
    ('bf98f12c-13dc-45a3-96dd-5853b9ee2328'::uuid, '155 Nguyễn Thái Bình', 'Quận 1', 106.6986478, 10.7681009)
)
UPDATE location l
SET district = reviewed.district,
    formatted_address = reviewed.street || ', ' || reviewed.district || ', Ho Chi Minh City',
    updated_at = now()
FROM reviewed
JOIN restaurant r ON r.id = reviewed.restaurant_id
WHERE r.location_id = l.id
  AND r.name ILIKE 'GÓC HUẾ%'
  AND r.website_url ILIKE '%gochuevn.com%'
  AND l.address_line = reviewed.street
  AND l.district = 'Quận 12'
  AND ST_DWithin(
    l.coordinates,
    ST_SetSRID(ST_MakePoint(reviewed.lon, reviewed.lat), 4326)::geography,
    100
  )
  AND NOT EXISTS (
    SELECT 1 FROM restaurant other WHERE other.location_id = l.id AND other.id <> r.id
  );
