-- The BeFood URL is a delivery listing, while the brand's own menu and
-- branch page explicitly list the 116 Le Van Sy, Phu Nhuan location.
-- Limit this correction to that exact branch so other delivery URLs remain
-- untouched and first-party menu ingestion retains its identity gate.
UPDATE restaurant r
SET website_url = 'https://www.banhmichimchay.vn/', updated_at = now()
FROM location l
WHERE r.location_id = l.id
  AND r.id = '63bc09ca-78c4-4b47-9746-d956d4cf1e6f'
  AND r.name = 'Bánh Mì Chim Chạy Lê Văn Sỹ Phú Nhuận'
  AND l.address_line = '116 Đ. Lê Văn Sỹ'
  AND l.district = 'Phú Nhuận'
  AND r.website_url LIKE 'https://food.be.com.vn/%';
