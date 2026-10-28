-- The restaurant's first-party menu explicitly names "Mì Udon nóng & thịt bò úc".
-- Preserve its displayed name and add the shorter Vietnamese identity used in
-- natural-language requests. Exact retrieval still requires this menu evidence.
-- http://thienhuongsushi.com/vi/menu.html (27 Hậu Giang, Tân Bình)
UPDATE dish d
SET description = 'Mì udon thịt bò: mì udon nóng với thịt bò Úc.'
FROM restaurant r
WHERE d.restaurant_id = r.id
  AND d.id = 'd73702f8-2ba1-4ec9-8134-a2e81e40d08a'
  AND r.id = 'd23e0341-a13c-416d-b210-5125134d078a'
  AND r.phone = '+84 903 787 501'
  AND d.name = 'Mì Udon nóng & thịt bò úc/BEEF UDON/牛肉うどん'
  AND d.source = 'website:menu:v1'
  AND (d.description IS NULL OR d.description = '');
