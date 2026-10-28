-- Shared first-party websites are valid only when the restaurant identity is
-- compatible with the site brand. The old website ingestion pass attached
-- Mộc Nhiên's vegetarian catalog to unrelated "Lẩu bò" Google Maps rows.
-- Keep the evidence auditable, but remove it from exact recommendation truth.
BEGIN;

CREATE TEMP TABLE shared_website_mismatch ON COMMIT DROP AS
SELECT DISTINCT d.id AS dish_id, d.restaurant_id, de.restaurant_image_id
FROM dish d
JOIN dish_evidence de
  ON de.dish_id = d.id AND de.evidence_type = 'menu_image'
JOIN menu_image_extraction mie
  ON mie.restaurant_image_id = de.restaurant_image_id
JOIN restaurant r ON r.id = d.restaurant_id
WHERE d.source = 'website:menu:v1'
  AND mie.model = 'website:menu:v1'
  AND r.website_url = 'https://nhahangmocnhien.vn/'
  AND lower(unaccent(r.name)) NOT LIKE '%moc nhien%';

INSERT INTO dish_evidence_quarantine
  (id, dish_id, restaurant_image_id, evidence_type, raw_name, raw_price,
   confidence, verified_at, quarantined_at, quarantine_reason)
SELECT de.id, de.dish_id, de.restaurant_image_id, de.evidence_type,
       de.raw_name, de.raw_price, de.confidence, de.verified_at, now(),
       'shared website identity does not match restaurant brand'
FROM dish_evidence de
JOIN shared_website_mismatch m
  ON m.dish_id = de.dish_id AND m.restaurant_image_id = de.restaurant_image_id
ON CONFLICT (id) DO NOTHING;

DELETE FROM dish_evidence de
USING shared_website_mismatch m
WHERE de.dish_id = m.dish_id
  AND de.restaurant_image_id = m.restaurant_image_id
  AND de.evidence_type = 'menu_image';

UPDATE dish d
SET status = 'unavailable', confidence = LEAST(COALESCE(d.confidence, 0), 0.1)
WHERE d.source = 'website:menu:v1'
  AND d.status = 'available'
  AND d.id IN (SELECT dish_id FROM shared_website_mismatch)
  AND NOT EXISTS (SELECT 1 FROM dish_evidence de WHERE de.dish_id = d.id);

UPDATE restaurant r
SET semantic_profile = NULL, updated_at = now()
WHERE r.id IN (SELECT DISTINCT restaurant_id FROM shared_website_mismatch);

COMMIT;
