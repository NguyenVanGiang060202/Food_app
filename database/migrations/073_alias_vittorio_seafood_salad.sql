-- The same reviewed official menu image labels "Insalata Di Mare" as
-- "Xà lách với hải sản trộn dầu oliu, cà chua tươi & ớt".
-- Preserve the Italian source name while grounding the Vietnamese request.
-- https://vittoriosaigon.com/vi/menu/salads-soups-186
WITH reviewed AS (
  SELECT 1
  FROM dish d
  JOIN restaurant r ON r.id = d.restaurant_id
  JOIN dish_evidence de ON de.dish_id = d.id AND de.raw_name = 'Insalata Di Mare'
  JOIN restaurant_image ri ON ri.id = de.restaurant_image_id
  JOIN menu_image_extraction mie ON mie.restaurant_image_id = ri.id
  WHERE d.id = 'b485fead-9ae0-42ab-8e67-5b948354b4fa'
    AND d.name = 'Insalata Di Mare'
    AND d.status = 'available'
    AND d.source = 'menu_image:curated'
    AND r.id = '7aa293c4-a435-4e56-8822-84aa2489869b'
    AND r.phone = '+84 28 6680 3134'
    AND ri.cached_content_hash = '1a710c76656e89edcf8370442feede7bcc60e0f977e31515fbeb6eca681f93af'
    AND mie.status = 'completed'
    AND mie.model = 'website:menu-image-curated:v1'
)
INSERT INTO canonical_dish (canonical_name, normalized_name)
SELECT 'Salad hải sản', 'salad hai san' WHERE EXISTS (SELECT 1 FROM reviewed)
ON CONFLICT (normalized_name) DO NOTHING;

INSERT INTO canonical_dish_alias (canonical_dish_id, alias, normalized_alias, source, confidence)
SELECT cd.id, 'Insalata Di Mare', 'insalata di mare', 'curated_bilingual_menu:v1', 0.98
FROM canonical_dish cd
WHERE cd.normalized_name = 'salad hai san'
  AND EXISTS (
    SELECT 1 FROM dish d
    JOIN dish_evidence de ON de.dish_id = d.id AND de.raw_name = 'Insalata Di Mare'
    JOIN restaurant_image ri ON ri.id = de.restaurant_image_id
    JOIN menu_image_extraction mie ON mie.restaurant_image_id = ri.id
    WHERE d.id = 'b485fead-9ae0-42ab-8e67-5b948354b4fa'
      AND d.restaurant_id = '7aa293c4-a435-4e56-8822-84aa2489869b'
      AND ri.cached_content_hash = '1a710c76656e89edcf8370442feede7bcc60e0f977e31515fbeb6eca681f93af'
      AND mie.model = 'website:menu-image-curated:v1'
  )
ON CONFLICT (normalized_alias) DO NOTHING;

UPDATE dish d
SET canonical_dish_id = cd.id,
    description = 'Xà lách hải sản trộn dầu ô liu, cà chua tươi và ớt.'
FROM canonical_dish cd
JOIN canonical_dish_alias cda ON cda.canonical_dish_id = cd.id
WHERE d.id = 'b485fead-9ae0-42ab-8e67-5b948354b4fa'
  AND d.restaurant_id = '7aa293c4-a435-4e56-8822-84aa2489869b'
  AND d.name = 'Insalata Di Mare'
  AND d.status = 'available'
  AND cd.normalized_name = 'salad hai san'
  AND cda.normalized_alias = 'insalata di mare'
  AND cda.source = 'curated_bilingual_menu:v1';
