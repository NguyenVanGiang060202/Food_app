-- CHẠM's first-party delivery page identifies its Cộng Hòa branch at
-- 18 Cộng Hòa, phường Tân Sơn Nhất, with matching 0979 366 601 hotline.
-- Its branch announcement names the area Tân Bình.
-- https://chamdalat.vn/en/delivery/
-- https://chamdalat.vn/en/cham-cafe-kem-bo-da-lat-khai-truong-cong-hoa/
UPDATE location l
SET ward = 'Tân Sơn Nhất',
    district = 'Tân Bình',
    formatted_address = '18 Cộng Hòa, Tân Sơn Nhất, Tân Bình, Ho Chi Minh City',
    updated_at = now()
FROM restaurant r
WHERE r.location_id = l.id
  AND r.id = 'c8bd15d5-28a7-4bf6-85a8-40baececb3b4'
  AND r.name = 'CHẠM Cafe & Kem Bơ Đà Lạt - Cộng Hoà'
  AND r.phone = '+84 979 366 601'
  AND r.website_url = 'https://chamdalat.vn/'
  AND l.address_line = '18 Cộng Hòa'
  AND l.district = 'Quận 1'
  AND ST_DWithin(
    l.coordinates,
    ST_SetSRID(ST_MakePoint(106.6607724, 10.8009363), 4326)::geography,
    100
  )
  AND NOT EXISTS (
    SELECT 1 FROM restaurant other WHERE other.location_id = l.id AND other.id <> r.id
  );
