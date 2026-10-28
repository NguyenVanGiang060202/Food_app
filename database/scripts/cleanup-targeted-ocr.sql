BEGIN;

CREATE TEMP TABLE affected_dishes AS
SELECT DISTINCT d.id
FROM dish d
JOIN dish_evidence de ON de.dish_id = d.id
WHERE d.source = 'menu_image:vision:v1'
  AND de.restaurant_image_id IN (
    'da85d854-978e-4535-8f81-aab6e0d02ced', 'b3b0d3ff-1e6c-49a6-af49-eae068952a0a',
    '8075155f-2436-4ec3-9386-9d25c1b97b39', '816ccda3-be6a-4319-a9e3-3aea216928bd',
    '25e67f42-d533-4b7c-b2f0-dc02ce83307f', '3a725f29-1486-4a4d-8173-6e98d81817cf',
    '6deedfb6-6f4c-41e9-a7f6-fb694c1d3bbe', 'b318289b-a0eb-45e0-9582-07fc730c7ff2',
    'e8830587-78f9-44fd-963c-0337bd4ff9b6', '50e0de36-727a-43bb-bd72-8e596fd000a5',
    '8f050f83-9f61-427e-b8f1-74492a94bdb1', '201239d7-7d98-437b-b5ed-0f913cf8a4a5'
  );

DELETE FROM dish_evidence de
USING dish d
WHERE de.dish_id = d.id
  AND d.source = 'menu_image:vision:v1'
  AND de.restaurant_image_id IN (
    'da85d854-978e-4535-8f81-aab6e0d02ced', 'b3b0d3ff-1e6c-49a6-af49-eae068952a0a',
    '8075155f-2436-4ec3-9386-9d25c1b97b39', '816ccda3-be6a-4319-a9e3-3aea216928bd',
    '25e67f42-d533-4b7c-b2f0-dc02ce83307f', '3a725f29-1486-4a4d-8173-6e98d81817cf',
    '6deedfb6-6f4c-41e9-a7f6-fb694c1d3bbe', 'b318289b-a0eb-45e0-9582-07fc730c7ff2',
    'e8830587-78f9-44fd-963c-0337bd4ff9b6', '50e0de36-727a-43bb-bd72-8e596fd000a5',
    '8f050f83-9f61-427e-b8f1-74492a94bdb1', '201239d7-7d98-437b-b5ed-0f913cf8a4a5'
  );

UPDATE dish d
SET status = 'unavailable', confidence = LEAST(COALESCE(d.confidence, 0), 0.1)
WHERE d.id IN (SELECT id FROM affected_dishes)
  AND d.status = 'available'
  AND NOT EXISTS (
    SELECT 1
    FROM dish_evidence de
    JOIN menu_image_extraction mie ON mie.restaurant_image_id = de.restaurant_image_id
    WHERE de.dish_id = d.id
      AND de.evidence_type = 'menu_image'
      AND mie.status = 'completed'
      AND mie.model IN ('website:menu:v1', 'google_maps:menu-curated:v1')
  );

COMMIT;
