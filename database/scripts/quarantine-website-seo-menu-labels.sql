-- Remove website SEO/branch captions that were incorrectly persisted as dishes.
-- These rows contain menu target words but are not menu item labels.
BEGIN;

CREATE TEMP TABLE suspicious_website_dish_evidence ON COMMIT DROP AS
SELECT d.id AS dish_id, d.restaurant_id, de.restaurant_image_id
FROM dish d
JOIN dish_evidence de ON de.dish_id = d.id AND de.evidence_type = 'menu_image'
JOIN menu_image_extraction mie ON mie.restaurant_image_id = de.restaurant_image_id
JOIN restaurant r ON r.id = d.restaurant_id
WHERE d.source = 'website:menu:v1'
  AND mie.model = 'website:menu:v1'
  AND (
    trim(regexp_replace(lower(unaccent(d.name)), '[^a-z0-9]+', ' ', 'g')) =
      trim(regexp_replace(lower(unaccent(r.name)), '[^a-z0-9]+', ' ', 'g'))
    OR length(d.name) > 80
    OR d.name ILIKE 'Top %'
    OR d.name ILIKE '%Quán %'
    OR d.name ILIKE '%Bình Thạnh%'
    OR d.name ILIKE '%Hậu Giang%'
    OR d.name ILIKE '%Nguyễn Ảnh Thủ%'
    OR d.name ILIKE '%Nguyễn Văn Nghi%'
    OR d.name ~* '(website|menu|review|địa\s*chỉ|dia\s*chi|chi\s*nh[aá]nh|phường|phuong|quận|\mq\.?\s*\d+\M|\mp\.?\s*\d+\M|hồ\s*chí\s*minh|ho\s*chi\s*minh)'
    OR lower(unaccent(d.name)) ~* '(menu[-_ ]|binh\s*thanh|go\s*vap|tan\s*binh|binh\s*tan|thu\s*duc|phu\s*nhuan|khai\s*truong)'
    OR lower(unaccent(d.name)) ~* '(mua\s*1\s*duoc\s*2|thong\s*bao|giao\s*ngay|ngai\s*gi\s*mua\s*nang|noi\s*mang\s*den|day\s*din[hg]\s*duong|uu\s*dai|khuyen\s*mai|dat\s*ngay|delivery|ship\s*hang)'
    OR array_length(regexp_split_to_array(trim(regexp_replace(lower(unaccent(d.name)), '[^a-z0-9]+', ' ', 'g')), '\\s+'), 1) > 9
  );

INSERT INTO dish_evidence_quarantine
  (id, dish_id, restaurant_image_id, evidence_type, raw_name, raw_price,
   confidence, verified_at, quarantined_at, quarantine_reason)
SELECT de.id, de.dish_id, de.restaurant_image_id, de.evidence_type,
       de.raw_name, de.raw_price, de.confidence, de.verified_at, now(),
       'website alt text is SEO, restaurant identity, branch, or promotion'
FROM dish_evidence de
JOIN suspicious_website_dish_evidence s
  ON s.dish_id = de.dish_id AND s.restaurant_image_id = de.restaurant_image_id
WHERE de.evidence_type = 'menu_image'
ON CONFLICT (id) DO NOTHING;

DELETE FROM dish_evidence de
USING suspicious_website_dish_evidence s
WHERE de.dish_id = s.dish_id
  AND de.restaurant_image_id = s.restaurant_image_id
  AND de.evidence_type = 'menu_image';

UPDATE dish d
SET status = 'unavailable', confidence = LEAST(COALESCE(d.confidence, 0), 0.1)
WHERE d.source = 'website:menu:v1'
  AND d.status = 'available'
  AND NOT EXISTS (SELECT 1 FROM dish_evidence de WHERE de.dish_id = d.id)
  AND (
    d.id IN (SELECT DISTINCT dish_id FROM suspicious_website_dish_evidence)
    OR trim(regexp_replace(lower(unaccent(d.name)), '[^a-z0-9]+', ' ', 'g')) IN (
      SELECT trim(regexp_replace(lower(unaccent(r2.name)), '[^a-z0-9]+', ' ', 'g'))
      FROM restaurant r2 WHERE r2.id = d.restaurant_id
    )
    OR length(d.name) > 80
    OR d.name ILIKE 'Top %'
    OR d.name ILIKE '%Quán %'
    OR d.name ILIKE '%Bình Thạnh%'
    OR d.name ILIKE '%Hậu Giang%'
    OR d.name ILIKE '%Nguyễn Ảnh Thủ%'
    OR d.name ILIKE '%Nguyễn Văn Nghi%'
  );

-- Also retire any old website rows that lost their only evidence in an earlier
-- cleanup pass. Keeping them available would make future profile rebuilds and
-- admin exports look as though the catalog still contains a menu fact.
UPDATE dish d
SET status = 'unavailable', confidence = LEAST(COALESCE(d.confidence, 0), 0.1)
WHERE d.source = 'website:menu:v1'
  AND d.status = 'available'
  AND NOT EXISTS (SELECT 1 FROM dish_evidence de WHERE de.dish_id = d.id);

UPDATE restaurant r
SET semantic_profile = NULL, updated_at = now()
WHERE r.id IN (
  SELECT DISTINCT d.restaurant_id
  FROM dish d
  WHERE d.source = 'website:menu:v1'
    AND d.status = 'unavailable'
    AND d.confidence <= 0.1
);

COMMIT;
