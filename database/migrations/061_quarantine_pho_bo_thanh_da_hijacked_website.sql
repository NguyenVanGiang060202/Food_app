-- The previously collected restaurant domain now redirects to an unrelated
-- gambling site. Do not expose it as the restaurant website or ingest menu
-- evidence from it until the restaurant's current first-party source is known.
UPDATE restaurant r
SET website_url = NULL, updated_at = now()
FROM location l
WHERE r.location_id = l.id
  AND r.id = '9ef3a290-6072-456a-b692-095d9b314a5d'
  AND r.name = 'Phở Bò Thanh Đa'
  AND l.address_line = '61 Bình Quới'
  AND r.website_url = 'http://phobothanhda.com/';
