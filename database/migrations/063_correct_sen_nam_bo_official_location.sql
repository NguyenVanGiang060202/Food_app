-- The restaurant's first-party contact/menu pages identify the site at
-- Cầu Kênh Một Tấn, Võ Chí Công, Phú Hữu, Quận 9, not Quận 12.
-- The existing phone and mapped point match; correct only this unshared row.
-- https://amthucsennambo.com/lien-he.html
UPDATE location l
SET address_line = 'Cầu Kênh Một Tấn, Đường Võ Chí Công',
    ward = 'Phú Hữu',
    district = 'Quận 9',
    formatted_address = 'Cầu Kênh Một Tấn, Đường Võ Chí Công, Phú Hữu, Quận 9, Ho Chi Minh City',
    updated_at = now()
FROM restaurant r
WHERE r.location_id = l.id
  AND r.id = '54500899-71d7-4383-b02b-a72f4849ce1a'
  AND r.name = 'Khu ẩm thực sinh thái Sen Nam Bộ'
  AND r.phone = '+84 896 628 111'
  AND r.website_url = 'http://amthucsennambo.com/'
  AND l.address_line = '506 Đ. Võ Chí Công'
  AND l.district = 'Quận 12'
  AND ST_DWithin(
    l.coordinates,
    ST_SetSRID(ST_MakePoint(106.7927183, 10.8097434), 4326)::geography,
    100
  )
  AND NOT EXISTS (
    SELECT 1 FROM restaurant other WHERE other.location_id = l.id AND other.id <> r.id
  );
