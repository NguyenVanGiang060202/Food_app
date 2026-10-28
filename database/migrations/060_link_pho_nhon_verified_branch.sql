-- The brand's own homepage lists its Thu Duc branch at 31 Nguyen Van Ba.
-- Link that exact existing record to the first-party menu for reviewed import.
UPDATE restaurant r
SET website_url = 'https://phonhon.vn/', updated_at = now()
FROM location l
WHERE r.location_id = l.id
  AND r.id = 'd44ee0da-f6a4-4ffb-bc8b-deb35193a55f'
  AND r.name ILIKE 'Phở NHON%'
  AND l.address_line = '31 Đ. Nguyễn Văn Bá'
  AND l.district = 'Thủ Đức'
  AND r.website_url IS NULL;
