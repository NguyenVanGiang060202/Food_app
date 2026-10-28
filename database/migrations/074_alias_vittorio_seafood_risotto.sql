-- The reviewed first-party menu prints "Risotto Ai Frutti Di Mare" with
-- "Cơm Ý, hải sản & sốt cà chua" on the same prepared-dish row.
-- https://vittoriosaigon.com/vi/menu/risotto-226
WITH reviewed AS (
  SELECT 1
  FROM dish d
  JOIN restaurant r ON r.id = d.restaurant_id
  JOIN dish_evidence de ON de.dish_id = d.id AND de.raw_name = 'Risotto Ai Frutti Di Mare'
  JOIN restaurant_image ri ON ri.id = de.restaurant_image_id
  JOIN menu_image_extraction mie ON mie.restaurant_image_id = ri.id
  WHERE d.id = '1ebbe1b1-1572-45ff-adb0-158e14284a3f'
    AND d.name = 'Risotto Ai Frutti Di Mare'
    AND d.status = 'available'
    AND d.source = 'menu_image:curated'
    AND r.id = '7aa293c4-a435-4e56-8822-84aa2489869b'
    AND r.phone = '+84 28 6680 3134'
    AND ri.cached_content_hash = '263688eedf65e320ce4ca080db1dc286b5a19b67f018388a21e066c7eb1aaaf4'
    AND mie.status = 'completed'
    AND mie.model = 'website:menu-image-curated:v1'
)
INSERT INTO canonical_dish (canonical_name, normalized_name)
SELECT 'Cơm Ý hải sản', 'com y hai san' WHERE EXISTS (SELECT 1 FROM reviewed)
ON CONFLICT (normalized_name) DO NOTHING;

INSERT INTO canonical_dish_alias (canonical_dish_id, alias, normalized_alias, source, confidence)
SELECT cd.id, 'Risotto Ai Frutti Di Mare', 'risotto ai frutti di mare', 'curated_bilingual_menu:v1', 0.98
FROM canonical_dish cd
WHERE cd.normalized_name = 'com y hai san'
  AND EXISTS (
    SELECT 1 FROM dish d
    JOIN dish_evidence de ON de.dish_id = d.id AND de.raw_name = 'Risotto Ai Frutti Di Mare'
    JOIN restaurant_image ri ON ri.id = de.restaurant_image_id
    JOIN menu_image_extraction mie ON mie.restaurant_image_id = ri.id
    WHERE d.id = '1ebbe1b1-1572-45ff-adb0-158e14284a3f'
      AND d.restaurant_id = '7aa293c4-a435-4e56-8822-84aa2489869b'
      AND ri.cached_content_hash = '263688eedf65e320ce4ca080db1dc286b5a19b67f018388a21e066c7eb1aaaf4'
      AND mie.model = 'website:menu-image-curated:v1'
  )
ON CONFLICT (normalized_alias) DO NOTHING;

UPDATE dish d
SET canonical_dish_id = cd.id,
    description = 'Cơm Ý hải sản với sốt cà chua.'
FROM canonical_dish cd
JOIN canonical_dish_alias cda ON cda.canonical_dish_id = cd.id
WHERE d.id = '1ebbe1b1-1572-45ff-adb0-158e14284a3f'
  AND d.restaurant_id = '7aa293c4-a435-4e56-8822-84aa2489869b'
  AND d.name = 'Risotto Ai Frutti Di Mare'
  AND d.status = 'available'
  AND cd.normalized_name = 'com y hai san'
  AND cda.normalized_alias = 'risotto ai frutti di mare'
  AND cda.source = 'curated_bilingual_menu:v1';
