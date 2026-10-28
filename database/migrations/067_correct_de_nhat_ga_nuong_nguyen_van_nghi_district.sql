-- The official branch page identifies 122 Nguyễn Văn Nghi, phường An Nhơn
-- as Gò Vấp (former district), with matching central hotline 028 8889 9199.
-- https://denhatganuong.com/khai-truong-de-nhat-ga-nuong-go-vap-cung-flash-sale-119k
UPDATE location l
SET ward = 'An Nhơn',
    district = 'Gò Vấp',
    formatted_address = '122 Nguyễn Văn Nghi, An Nhơn, Gò Vấp, Ho Chi Minh City',
    updated_at = now()
FROM restaurant r
WHERE r.location_id = l.id
  AND r.id = 'd1febd20-708f-4299-b50d-2d74919cb2c8'
  AND r.name = 'Gà Nướng Muối Ớt, Gà Nướng Mắm Nhĩ - Đệ Nhất Gà Nướng - 122 Nguyễn Văn Nghi, An Nhơn (Gò Vấp cũ)'
  AND r.phone = '+84 28 8889 9199'
  AND r.website_url = 'https://denhatganuong.com/'
  AND l.address_line = '122 Đ.Nguyễn Văn Nghi'
  AND l.district = 'Quận 12'
  AND ST_DWithin(
    l.coordinates,
    ST_SetSRID(ST_MakePoint(106.6876871, 10.8234178), 4326)::geography,
    100
  )
  AND NOT EXISTS (
    SELECT 1 FROM restaurant other WHERE other.location_id = l.id AND other.id <> r.id
  );
