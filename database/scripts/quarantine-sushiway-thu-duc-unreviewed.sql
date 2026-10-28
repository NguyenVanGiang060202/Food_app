-- Local one-off curation, 2026-10-25. SushiWay's shared website catalog was
-- previously attached wholesale to the Đặng Văn Bi branch. Four product
-- variants have current, first-party Moonlight pickup evidence; the others
-- must not be treated as this branch's verified menu.
BEGIN;

CREATE TEMP TABLE sushiway_approved (normalized_name text PRIMARY KEY, price_amount numeric(12,2), raw_price text) ON COMMIT DROP;
INSERT INTO sushiway_approved VALUES
  ('maki luon', 79000, '79.000 VND'),
  ('maki trung', 45000, '45.000 VND'),
  ('sushi tom', 35000, '35.000 VND'),
  ('ramen xa xiu nuoc', 179000, '179.000 VND');

DO $$
BEGIN
  IF (SELECT count(*) FROM restaurant WHERE id='1ebaad7a-1f55-499d-8ded-312c2f768126' AND name='SushiWay Thủ Đức') <> 1 THEN
    RAISE EXCEPTION 'SushiWay Đặng Văn Bi identity mismatch';
  END IF;
  IF (SELECT count(DISTINCT d.id)
      FROM dish d JOIN sushiway_approved a ON a.normalized_name=d.normalized_name
      JOIN dish_evidence de ON de.dish_id=d.id
      JOIN restaurant_image ri ON ri.id=de.restaurant_image_id AND ri.url LIKE '%width=1920%'
      JOIN menu_image_extraction mie ON mie.restaurant_image_id=ri.id
      WHERE d.restaurant_id='1ebaad7a-1f55-499d-8ded-312c2f768126'
        AND d.status='available' AND d.source='website:menu:v1'
        AND mie.status='completed' AND mie.model='website:menu:v1') <> 4 THEN
    RAISE EXCEPTION 'Four product-page-scoped approved rows are required';
  END IF;
END $$;

CREATE TEMP TABLE sushiway_rejected ON COMMIT DROP AS
SELECT d.id AS dish_id, de.id AS evidence_id, de.restaurant_image_id
FROM dish d
JOIN dish_evidence de ON de.dish_id=d.id
WHERE d.restaurant_id='1ebaad7a-1f55-499d-8ded-312c2f768126'
  AND d.status='available' AND d.source='website:menu:v1'
  AND NOT EXISTS (SELECT 1 FROM sushiway_approved a WHERE a.normalized_name=d.normalized_name);

INSERT INTO dish_evidence_quarantine
  (id,dish_id,restaurant_image_id,evidence_type,raw_name,raw_price,confidence,verified_at,quarantined_at,quarantine_reason)
SELECT de.id,de.dish_id,de.restaurant_image_id,de.evidence_type,de.raw_name,de.raw_price,
       de.confidence,de.verified_at,now(),
       'SushiWay shared catalog item without verified pickup at Moonlight, 102 Dang Van Bi'
FROM dish_evidence de JOIN sushiway_rejected q ON q.evidence_id=de.id
ON CONFLICT (id) DO NOTHING;

DELETE FROM dish_evidence de USING sushiway_rejected q WHERE de.id=q.evidence_id;

UPDATE dish d SET status='unavailable', confidence=LEAST(COALESCE(d.confidence,0),0.1)
WHERE d.id IN (SELECT dish_id FROM sushiway_rejected)
  AND NOT EXISTS (SELECT 1 FROM dish_evidence de WHERE de.dish_id=d.id);

UPDATE menu_image_extraction mie
SET status='not_menu', model='website:menu:unreviewed:v1', confidence=0.1,
    error_message='Moonlight branch pickup unverified for this shared catalog item', updated_at=now()
WHERE mie.restaurant_image_id IN (SELECT restaurant_image_id FROM sushiway_rejected)
  AND NOT EXISTS (SELECT 1 FROM dish_evidence de WHERE de.restaurant_image_id=mie.restaurant_image_id);

UPDATE dish d SET price_amount=a.price_amount, currency_code='VND'
FROM sushiway_approved a
WHERE d.restaurant_id='1ebaad7a-1f55-499d-8ded-312c2f768126'
  AND d.normalized_name=a.normalized_name AND d.status='available';

UPDATE dish_evidence de SET raw_price=a.raw_price
FROM dish d JOIN sushiway_approved a ON a.normalized_name=d.normalized_name
WHERE de.dish_id=d.id AND d.restaurant_id='1ebaad7a-1f55-499d-8ded-312c2f768126';

UPDATE location l SET address_line='Moonlight, 102 Đặng Văn Bi',
  formatted_address='Moonlight, 102 Đặng Văn Bi, TP. Thủ Đức, TP. Hồ Chí Minh', updated_at=now()
FROM restaurant r
WHERE r.location_id=l.id AND r.id='1ebaad7a-1f55-499d-8ded-312c2f768126';

UPDATE restaurant SET phone='+84 899 094 783', website_url='https://sushiway.com.vn/',
  semantic_profile=NULL, updated_at=now()
WHERE id='1ebaad7a-1f55-499d-8ded-312c2f768126';

SELECT (SELECT count(DISTINCT dish_id) FROM sushiway_rejected) AS quarantined_dishes,
       (SELECT count(*) FROM sushiway_rejected) AS quarantined_evidence,
       (SELECT count(*) FROM dish WHERE restaurant_id='1ebaad7a-1f55-499d-8ded-312c2f768126'
         AND status='available' AND source='website:menu:v1') AS branch_verified_dishes;
COMMIT;
