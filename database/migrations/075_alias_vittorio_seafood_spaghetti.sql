-- The reviewed official menu prints "Spaghetti Allo Scoglio" with
-- "Mì Ý với hải sản, tỏi, ớt, lá ngò tây & sốt cà chua" on one dish row.
-- https://vittoriosaigon.com/vi/menu/spaghetti-188
WITH reviewed AS (
  SELECT 1
  FROM dish d
  JOIN restaurant r ON r.id = d.restaurant_id
  JOIN dish_evidence de ON de.dish_id = d.id AND de.raw_name = 'Spaghetti Allo Scoglio'
  JOIN restaurant_image ri ON ri.id = de.restaurant_image_id
  JOIN menu_image_extraction mie ON mie.restaurant_image_id = ri.id
  WHERE d.id = '81bbdc39-a279-44ae-a0ba-7c1e317903e8'
    AND d.name = 'Spaghetti Allo Scoglio'
    AND d.status = 'available'
    AND d.source = 'menu_image:curated'
    AND r.id = '7aa293c4-a435-4e56-8822-84aa2489869b'
    AND r.phone = '+84 28 6680 3134'
    AND ri.cached_content_hash = 'bef512269406db438b0b72a110925084cd9f4dc38b09c1a909067e93aa3d504d'
    AND mie.status = 'completed'
    AND mie.model = 'website:menu-image-curated:v1'
)
INSERT INTO canonical_dish (canonical_name, normalized_name)
SELECT 'Mì Ý hải sản', 'mi y hai san' WHERE EXISTS (SELECT 1 FROM reviewed)
ON CONFLICT (normalized_name) DO NOTHING;

INSERT INTO canonical_dish_alias (canonical_dish_id, alias, normalized_alias, source, confidence)
SELECT cd.id, 'Spaghetti Allo Scoglio', 'spaghetti allo scoglio', 'curated_bilingual_menu:v1', 0.98
FROM canonical_dish cd
WHERE cd.normalized_name = 'mi y hai san'
  AND EXISTS (
    SELECT 1 FROM dish d
    JOIN dish_evidence de ON de.dish_id = d.id AND de.raw_name = 'Spaghetti Allo Scoglio'
    JOIN restaurant_image ri ON ri.id = de.restaurant_image_id
    JOIN menu_image_extraction mie ON mie.restaurant_image_id = ri.id
    WHERE d.id = '81bbdc39-a279-44ae-a0ba-7c1e317903e8'
      AND d.restaurant_id = '7aa293c4-a435-4e56-8822-84aa2489869b'
      AND ri.cached_content_hash = 'bef512269406db438b0b72a110925084cd9f4dc38b09c1a909067e93aa3d504d'
      AND mie.model = 'website:menu-image-curated:v1'
  )
ON CONFLICT (normalized_alias) DO NOTHING;

UPDATE dish d
SET canonical_dish_id = cd.id,
    description = 'Mì Ý hải sản với tỏi, ớt, ngò tây và sốt cà chua.'
FROM canonical_dish cd
JOIN canonical_dish_alias cda ON cda.canonical_dish_id = cd.id
WHERE d.id = '81bbdc39-a279-44ae-a0ba-7c1e317903e8'
  AND d.restaurant_id = '7aa293c4-a435-4e56-8822-84aa2489869b'
  AND d.name = 'Spaghetti Allo Scoglio'
  AND d.status = 'available'
  AND cd.normalized_name = 'mi y hai san'
  AND cda.normalized_alias = 'spaghetti allo scoglio'
  AND cda.source = 'curated_bilingual_menu:v1';
