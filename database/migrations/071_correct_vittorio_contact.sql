-- Vittorio's current first-party menu identifies its sole Khánh Hội location
-- as 240 Khánh Hội, Quận 4 with phone 028 6680 3134 / 0938 334 236.
-- The imported Maps phone on this exact local record differs.
-- https://vittoriosaigon.com/vi/menu
UPDATE restaurant r
SET phone = '+84 28 6680 3134', updated_at = now()
FROM location l
WHERE r.location_id = l.id
  AND r.id = '7aa293c4-a435-4e56-8822-84aa2489869b'
  AND r.name = 'Vittorio Italian Restaurant'
  AND r.phone = '+84 28 3622 0500'
  AND r.website_url = 'http://www.vittoriosaigon.com/'
  AND l.address_line = '240 Khánh Hội'
  AND l.district = 'Quận 4'
  AND ST_DWithin(
    l.coordinates,
    ST_SetSRID(ST_MakePoint(106.6988988, 10.7592665), 4326)::geography,
    100
  )
  AND NOT EXISTS (
    SELECT 1 FROM restaurant other WHERE other.location_id = l.id AND other.id <> r.id
  );
