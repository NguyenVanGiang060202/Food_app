-- Vittorio's first-party soup menu prints both "Zuppa Di Zucca" and
-- "Súp bí đỏ" on the same reviewed image. Keep the source dish name while
-- making its verified Vietnamese identity searchable.
-- https://vittoriosaigon.com/vi/menu/salads-soups-186
WITH reviewed AS (
  SELECT d.id
  FROM dish d
  JOIN restaurant r ON r.id = d.restaurant_id
  JOIN dish_evidence de ON de.dish_id = d.id AND de.raw_name = 'Zuppa Di Zucca'
  JOIN restaurant_image ri ON ri.id = de.restaurant_image_id
  JOIN menu_image_extraction mie ON mie.restaurant_image_id = ri.id
  WHERE d.id = '8a50e01e-dc1a-43cb-935c-9bd9ab06a193'
    AND d.name = 'Zuppa Di Zucca'
    AND d.status = 'available'
    AND d.source = 'menu_image:curated'
    AND r.id = '7aa293c4-a435-4e56-8822-84aa2489869b'
    AND r.phone = '+84 28 6680 3134'
    AND ri.cached_content_hash = '1a710c76656e89edcf8370442feede7bcc60e0f977e31515fbeb6eca681f93af'
    AND mie.status = 'completed'
    AND mie.model = 'website:menu-image-curated:v1'
)
INSERT INTO canonical_dish_alias (canonical_dish_id, alias, normalized_alias, source, confidence)
SELECT cd.id, 'Zuppa Di Zucca', 'zuppa di zucca', 'curated_bilingual_menu:v1', 0.98
FROM canonical_dish cd
WHERE cd.normalized_name = 'sup bi do'
  AND EXISTS (SELECT 1 FROM reviewed)
ON CONFLICT (normalized_alias) DO NOTHING;

UPDATE dish d
SET canonical_dish_id = cd.id,
    description = 'Súp bí đỏ (Zuppa Di Zucca).'
FROM canonical_dish cd
JOIN canonical_dish_alias cda ON cda.canonical_dish_id = cd.id
WHERE d.id = '8a50e01e-dc1a-43cb-935c-9bd9ab06a193'
  AND d.restaurant_id = '7aa293c4-a435-4e56-8822-84aa2489869b'
  AND d.name = 'Zuppa Di Zucca'
  AND d.status = 'available'
  AND cd.normalized_name = 'sup bi do'
  AND cda.normalized_alias = 'zuppa di zucca'
  AND cda.source = 'curated_bilingual_menu:v1';
