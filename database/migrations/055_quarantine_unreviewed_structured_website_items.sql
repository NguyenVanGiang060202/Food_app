-- A MenuItem JSON-LD type is not enough to prove a prepared, purchasable dish.
-- The 2026-10-21 unattended sweep admitted live seafood inventory and SEO
-- product headings. Preserve the evidence for source-level review, but remove
-- it from exact-dish recommendations until each website is reviewed.
BEGIN;

CREATE TEMP TABLE unreviewed_structured_website_items ON COMMIT DROP AS
SELECT DISTINCT d.id AS dish_id, d.restaurant_id, de.restaurant_image_id
FROM dish d
JOIN dish_evidence de ON de.dish_id = d.id AND de.evidence_type = 'menu_image'
JOIN menu_image_extraction mie ON mie.restaurant_image_id = de.restaurant_image_id
WHERE d.source = 'website:menu:v1'
  AND d.status = 'available'
  AND mie.model = 'website:menu:v1'
  AND mie.updated_at >= '2026-10-21T06:43:24Z'::timestamptz
  AND d.restaurant_id IN (
    '605982b3-d848-4c08-9447-0f63bbdb14c1'::uuid,
    '95431b4a-5a0e-498d-ba34-62b7191078cd'::uuid,
    '9c56a6a6-c52a-41d6-8e64-03196fe251f7'::uuid,
    '2e5bdf6c-95b7-4ed4-b30f-63f833d4bb2e'::uuid
  );

INSERT INTO dish_evidence_quarantine
  (id, dish_id, restaurant_image_id, evidence_type, raw_name, raw_price,
   confidence, verified_at, quarantined_at, quarantine_reason)
SELECT de.id, de.dish_id, de.restaurant_image_id, de.evidence_type,
       de.raw_name, de.raw_price, de.confidence, de.verified_at, now(),
       'unreviewed structured website item may be live inventory or SEO product text'
FROM dish_evidence de
JOIN unreviewed_structured_website_items q
  ON q.dish_id = de.dish_id AND q.restaurant_image_id = de.restaurant_image_id
ON CONFLICT (id) DO NOTHING;

DELETE FROM dish_evidence de
USING unreviewed_structured_website_items q
WHERE de.dish_id = q.dish_id
  AND de.restaurant_image_id = q.restaurant_image_id
  AND de.evidence_type = 'menu_image';

UPDATE dish d
SET status = 'unavailable', confidence = LEAST(COALESCE(d.confidence, 0), 0.1)
WHERE d.id IN (SELECT dish_id FROM unreviewed_structured_website_items)
  AND NOT EXISTS (SELECT 1 FROM dish_evidence de WHERE de.dish_id = d.id);

UPDATE menu_image_extraction mie
SET status = 'not_menu', model = 'website:menu:unreviewed:v1',
    confidence = 0.1,
    error_message = 'structured website listing awaits source-level dish review',
    updated_at = now()
WHERE mie.restaurant_image_id IN
  (SELECT restaurant_image_id FROM unreviewed_structured_website_items);

UPDATE restaurant r
SET semantic_profile = NULL, updated_at = now()
WHERE r.id IN (SELECT DISTINCT restaurant_id FROM unreviewed_structured_website_items);

COMMIT;
