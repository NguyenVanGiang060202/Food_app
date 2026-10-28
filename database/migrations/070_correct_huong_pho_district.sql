-- Hương Phố's official contact lists A12 Phan Văn Trị, Hạnh Thông and
-- 028 3989 6179. Its own articles identify this location as Gò Vấp.
-- https://huongpho.com.vn/contact/
-- https://huongpho.com.vn/phuc-loc-tho-mon-khai-vi-dam-da-huong-vi-cuoc-song/
UPDATE location l
SET ward = 'Hạnh Thông',
    district = 'Gò Vấp',
    formatted_address = 'A12 Phan Văn Trị, Hạnh Thông, Gò Vấp, Ho Chi Minh City',
    updated_at = now()
FROM restaurant r
WHERE r.location_id = l.id
  AND r.id = '94930016-8924-4f80-ae83-a6e32c272e84'
  AND r.name = 'Nhà Hàng Hương Phố'
  AND r.phone = '+84 28 3989 6179'
  AND r.website_url = 'http://huongpho.com.vn/'
  AND l.address_line = 'A12 Đ. Phan Văn Trị'
  AND NULLIF(l.district, '') IS NULL
  AND ST_DWithin(
    l.coordinates,
    ST_SetSRID(ST_MakePoint(106.6833645, 10.8287013), 4326)::geography,
    100
  )
  AND NOT EXISTS (
    SELECT 1 FROM restaurant other WHERE other.location_id = l.id AND other.id <> r.id
  );
