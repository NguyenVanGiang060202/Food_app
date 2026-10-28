-- The restaurant's first-party contact page places 27 Hậu Giang in
-- P. Tân Sơn Nhất. The same phone and mapped point are in Tân Bình, not
-- Bình Tân; independent listings corroborate the former district.
-- http://thienhuongsushi.com/vi/lien-he.html
UPDATE location l
SET ward = 'Tân Sơn Nhất',
    district = 'Tân Bình',
    formatted_address = '27 Hậu Giang, Tân Bình, Ho Chi Minh City',
    updated_at = now()
FROM restaurant r
WHERE r.location_id = l.id
  AND r.id = 'd23e0341-a13c-416d-b210-5125134d078a'
  AND r.name = 'Nhà Hàng Thiên Hương Sushi'
  AND r.phone = '+84 903 787 501'
  AND r.website_url = 'http://thienhuongsushi.com/'
  AND l.address_line = '27 Hậu Giang'
  AND l.district = 'Bình Tân'
  AND ST_DWithin(
    l.coordinates,
    ST_SetSRID(ST_MakePoint(106.6629292, 10.8077913), 4326)::geography,
    100
  )
  AND NOT EXISTS (
    SELECT 1 FROM restaurant other WHERE other.location_id = l.id AND other.id <> r.id
  );
