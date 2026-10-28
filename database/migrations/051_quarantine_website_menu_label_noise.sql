-- Website catalog alt text can be a product slug, restaurant identity, SEO
-- headline, or promotion rather than a purchasable dish. Keep the source and
-- audit trail, but remove known generic/brand labels from exact evidence.
BEGIN;

CREATE TEMP TABLE website_label_noise ON COMMIT DROP AS
SELECT DISTINCT d.id AS dish_id, d.restaurant_id, de.restaurant_image_id
FROM dish d
JOIN dish_evidence de
  ON de.dish_id = d.id AND de.evidence_type = 'menu_image'
JOIN menu_image_extraction mie
  ON mie.restaurant_image_id = de.restaurant_image_id
JOIN restaurant r ON r.id = d.restaurant_id
WHERE d.source = 'website:menu:v1'
  AND d.status = 'available'
  AND mie.status = 'completed'
  AND mie.model = 'website:menu:v1'
  AND (
    -- exact restaurant/brand identity copied into an image alt
    trim(regexp_replace(lower(unaccent(d.name)), '[^a-z0-9]+', ' ', 'g')) =
      trim(regexp_replace(lower(unaccent(r.name)), '[^a-z0-9]+', ' ', 'g'))
    -- generic website labels are not exact dishes
    OR lower(unaccent(d.name)) ~* '^(com[-_ ]tam[-_ ](cali|khac)|mat[-_ ]tien)([-_ ]|$)'
    -- a technical image filename is not a user-facing menu item unless it
    -- contains a concrete dish slug; the known generic brand slug is noise.
    OR lower(trim(d.name)) IN ('menu-de-nhat-ga-nuong', 'menu de nhat ga nuong')
  );

INSERT INTO dish_evidence_quarantine
  (id, dish_id, restaurant_image_id, evidence_type, raw_name, raw_price,
   confidence, verified_at, quarantined_at, quarantine_reason)
SELECT de.id, de.dish_id, de.restaurant_image_id, de.evidence_type,
       de.raw_name, de.raw_price, de.confidence, de.verified_at, now(),
       'website label is restaurant identity or generic catalog metadata'
FROM dish_evidence de
JOIN website_label_noise n
  ON n.dish_id = de.dish_id AND n.restaurant_image_id = de.restaurant_image_id
ON CONFLICT (id) DO NOTHING;

DELETE FROM dish_evidence de
USING website_label_noise n
WHERE de.dish_id = n.dish_id
  AND de.restaurant_image_id = n.restaurant_image_id
  AND de.evidence_type = 'menu_image';

UPDATE dish d
SET status = 'unavailable', confidence = LEAST(COALESCE(d.confidence, 0), 0.1)
WHERE d.source = 'website:menu:v1'
  AND d.status = 'available'
  AND NOT EXISTS (SELECT 1 FROM dish_evidence de WHERE de.dish_id = d.id)
  AND (
    d.id IN (SELECT dish_id FROM website_label_noise)
    OR lower(unaccent(d.name)) ~* '^(com[-_ ]tam[-_ ](cali|khac)|mat[-_ ]tien)([-_ ]|$)'
    OR lower(trim(d.name)) IN ('menu-de-nhat-ga-nuong', 'menu de nhat ga nuong')
  );

COMMIT;
