-- The chain's former .com homepage now redirects to its current .vn site.
-- Correct only the verified Nguyen Van Trang branch; the crawler continues to
-- reject arbitrary cross-domain redirects as a source-identity safeguard.
UPDATE restaurant r
SET website_url = 'https://dauhomemade.vn/', updated_at = now()
FROM location l
WHERE r.location_id = l.id
  AND r.website_url = 'http://dauhomemade.com/'
  AND r.name ILIKE '%Đậu Homemade%'
  AND l.address_line = '1 Nguyễn Văn Tráng'
  AND l.district = 'Quận 1';
