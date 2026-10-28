-- Official order page lists "Seafood" under pizza slices and describes its
-- seafood toppings. Preserve the displayed name; add a reviewed Vietnamese
-- identity so exact-dish retrieval can ground "pizza hải sản" in this item.
-- https://www.paperplatepizza.com/order (25/26B Tôn Thất Tùng, Quận 1)
UPDATE dish d
SET description = 'Pizza hải sản: sốt cà chua, phô mai Mozzarella, tôm, mực, thanh cua, cá ngừ, hành tím.'
FROM restaurant r
WHERE d.restaurant_id = r.id
  AND d.id = '3f8f4f51-dd9c-4d83-808f-e2577092ef45'
  AND r.id = '922b968f-491b-4780-8ea3-eca7a8f75fef'
  AND r.website_url = 'https://www.paperplatepizza.com/order'
  AND d.name = 'Seafood'
  AND d.source = 'website:menu:v1'
  AND (d.description IS NULL OR d.description = '');
