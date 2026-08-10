-- Food attribute taxonomy for multi-dimensional dish classification.
--
-- Previous "taste" queries matched dish names with `ILIKE '%nóng%'`, which
-- could not represent khẩu vị (taste), nguyên liệu (ingredient), cách chế
-- biến (cooking method) or cảm giác (feeling). A restaurant that served no
-- literal "nóng"/"ngọt" dish name silently disappeared from the result, and a
-- fallback then returned unrelated top-rated restaurants (e.g. Cơm tấm for a
-- "món ngọt nóng" filter).
--
-- `food_attribute` is a small canonical taxonomy across explicit dimensions.
-- `dish_attribute` links canonical dishes to attributes with provenance
-- (`source` + `confidence`), matching the enrichment data-quality policy.

CREATE TABLE IF NOT EXISTS food_attribute (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  normalized text NOT NULL,
  dimension text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS dish_attribute (
  dish_id uuid NOT NULL REFERENCES dish(id) ON DELETE RESTRICT,
  attribute_id uuid NOT NULL REFERENCES food_attribute(id) ON DELETE RESTRICT,
  source text,
  confidence numeric(4,3),
  PRIMARY KEY (dish_id, attribute_id),
  CONSTRAINT dish_attribute_confidence_chk CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1)
);

CREATE INDEX IF NOT EXISTS dish_attribute_attribute_idx ON dish_attribute (attribute_id);
CREATE INDEX IF NOT EXISTS food_attribute_active_dimension_idx
  ON food_attribute (dimension) WHERE is_active = true;

ALTER TABLE enrichment_log
  ADD COLUMN IF NOT EXISTS attributes_applied integer NOT NULL DEFAULT 0;

-- Canonical taxonomy. `normalized` is the accent-free lowercase form used to
-- match incoming Vietnamese filter values (e.g. "Nóng" -> "nong").
INSERT INTO food_attribute (code, name, normalized, dimension) VALUES
  -- Khẩu vị (taste)
  ('hot',          'Nóng',       'nong',       'taste'),
  ('spicy',        'Cay',        'cay',        'taste'),
  ('sweet',        'Ngọt',       'ngot',       'taste'),
  ('salty',        'Mặn',        'man',        'taste'),
  ('sour',         'Chua',       'chua',       'taste'),
  ('creamy',       'Béo',        'beo',        'taste'),
  ('crispy',       'Giòn',       'gion',       'taste'),
  ('cool',         'Mát',        'mat',        'taste'),
  ('fresh',        'Tươi',       'tuoi',       'taste'),
  ('bold',         'Đậm đà',     'dam da',     'taste'),
  ('light',        'Thanh đạm',  'thanh dam',  'taste'),
  -- Cảm giác / mức no (feeling / fullness)
  ('light-belly',  'Nhẹ bụng',    'nhe bung',   'feel'),
  ('filling',      'No lâu',      'no lau',     'feel'),
  ('snack',        'Ăn vặt',      'an vat',     'feel'),
  ('full-meal',    'Đầy bữa',     'day bua',    'feel'),
  -- Nguyên liệu (ingredient)
  ('beef',         'Thịt bò',     'thit bo',    'ingredient'),
  ('chicken',      'Thịt gà',     'thit ga',    'ingredient'),
  ('pork',         'Thịt heo',    'thit heo',   'ingredient'),
  ('shrimp',       'Tôm',         'tom',        'ingredient'),
  ('crab',         'Cua',         'cua',        'ingredient'),
  ('fish',         'Cá',          'ca',         'ingredient'),
  ('snail',        'Ốc',          'oc',         'ingredient'),
  ('egg',          'Trứng',       'trung',      'ingredient'),
  ('seafood',      'Hải sản',     'hai san',    'ingredient'),
  ('vegetarian',   'Chay',        'chay',       'ingredient'),
  -- Cách chế biến / cách ăn (cooking method / style)
  ('grilled',      'Nướng',       'nuong',      'method'),
  ('fried',        'Chiên',       'chien',      'method'),
  ('steamed',      'Hấp',         'hap',        'method'),
  ('street',       'Đường phố',   'duong pho',  'method')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    normalized = EXCLUDED.normalized,
    dimension = EXCLUDED.dimension,
    is_active = true;

COMMENT ON TABLE food_attribute IS
  'Canonical multi-dimensional food attributes (khẩu vị, nguyên liệu, cách ăn, cảm giác).';
COMMENT ON TABLE dish_attribute IS
  'Dish-to-attribute links with enrichment provenance.';
COMMENT ON COLUMN food_attribute.normalized IS
  'Accent-free lowercase form used to match incoming Vietnamese filter values.';