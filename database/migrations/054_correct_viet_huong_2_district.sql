-- The source district for this specific venue was parsed as Quận 8 even
-- though its 20 Phạm Văn Đồng address belongs to Gò Vấp. Keep the source
-- coordinates; change only this unshared location row when all identity and
-- coordinate checks match. Re-running the migration is a no-op.
UPDATE location l
SET district = 'Gò Vấp',
    formatted_address = '20 Đ. Phạm Văn Đồng, Gò Vấp, Ho Chi Minh City',
    updated_at = now()
FROM restaurant r
WHERE r.location_id = l.id
  AND r.normalized_name = 'ga nuong lu viet huong 2'
  AND l.address_line = '20 Đ. Phạm Văn Đồng'
  AND l.district = 'Quận 8'
  AND ST_DWithin(
    l.coordinates,
    ST_SetSRID(ST_MakePoint(106.6795742, 10.8139438), 4326)::geography,
    100
  )
  AND NOT EXISTS (
    SELECT 1 FROM restaurant other WHERE other.location_id = l.id AND other.id <> r.id
  );
