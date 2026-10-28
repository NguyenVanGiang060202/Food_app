-- Domino's official store list identifies this exact branch at
-- 38/5 Lê Thị Hà, Hóc Môn, with the same 1900 6099 order hotline.
-- https://dominos.vn/blog-detail/quan-pizza-ngon-nhat-o-sai-gon
UPDATE location l
SET address_line = '38/5 Lê Thị Hà',
    district = 'Hóc Môn',
    formatted_address = '38/5 Lê Thị Hà, Hóc Môn, Ho Chi Minh City',
    updated_at = now()
FROM restaurant r
WHERE r.location_id = l.id
  AND r.id = 'a2e255d5-06e7-4f47-9914-81835ad7c5d7'
  AND r.name = 'Domino''s Pizza Lê Thị Hà'
  AND r.phone = '+84 1900 6099'
  AND r.website_url = 'https://dominos.vn/khuyen-mai'
  AND l.address_line = '38/5 Khu Phố 8'
  AND l.district = 'Quận 8'
  AND ST_DWithin(
    l.coordinates,
    ST_SetSRID(ST_MakePoint(106.5983977, 10.8864207), 4326)::geography,
    100
  )
  AND NOT EXISTS (
    SELECT 1 FROM restaurant other WHERE other.location_id = l.id AND other.id <> r.id
  );
