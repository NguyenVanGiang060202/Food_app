-- Tân Việt Nhật's Tokyo Deli employer profile identifies this branch at
-- 242-244 Phan Xích Long, phường Cầu Kiệu. Its older address is in the
-- former Quận Phú Nhuận, confirmed independently by the merchant list.
-- https://www.topcv.vn/cong-ty/tnhh-thuc-pham-tan-viet-nhat/30938.html
-- https://www.vietcombank.com.vn/upload/2018/01/04/Moca_tokyodeli_DSnhahang.pdf
UPDATE location l
SET ward = 'Cầu Kiệu',
    district = 'Phú Nhuận',
    formatted_address = '242 - 244 Phan Xích Long, Cầu Kiệu, Phú Nhuận, Ho Chi Minh City',
    updated_at = now()
FROM restaurant r
WHERE r.location_id = l.id
  AND r.id = '097f4b9f-ef96-4f87-9165-30d87f712220'
  AND r.name = 'Tokyo Deli Phan Xích Long'
  AND r.phone = '+84 28 3517 2777'
  AND r.website_url = 'https://tokyodeli.com.vn/dat-ban'
  AND l.address_line = '242 - 244 Phan Xích Long'
  AND (l.district IS NULL OR l.district = '')
  AND ST_DWithin(
    l.coordinates,
    ST_SetSRID(ST_MakePoint(106.6896485, 10.797929), 4326)::geography,
    100
  )
  AND NOT EXISTS (
    SELECT 1 FROM restaurant other WHERE other.location_id = l.id AND other.id <> r.id
  );
