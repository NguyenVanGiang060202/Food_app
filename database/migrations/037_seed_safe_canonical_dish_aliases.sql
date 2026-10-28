-- Only spelling-equivalent aliases are seeded here. Broader phrases such as
-- "bún bò" must not alias to "bún bò Huế", and "cơm tấm" must not alias to
-- "cơm tấm sườn"; those are distinct recommendation intents.
INSERT INTO canonical_dish_alias (canonical_dish_id, alias, normalized_alias, source, confidence)
SELECT cd.id, v.alias, v.normalized_alias, 'curated_exact_alias:v1', 1.0
FROM canonical_dish cd
JOIN (VALUES
  ('bun bo hue', 'bún bò huế', 'bun bo hue'),
  ('pho bo', 'phở bò', 'pho bo'),
  ('pho ga', 'phở gà', 'pho ga'),
  ('bun rieu', 'bún riêu', 'bun rieu'),
  ('bun thit nuong', 'bún thịt nướng', 'bun thit nuong'),
  ('bun dau mam tom', 'bún đậu mắm tôm', 'bun dau mam tom'),
  ('hu tieu nam vang', 'hủ tiếu Nam Vang', 'hu tieu nam vang'),
  ('mi quang', 'mì Quảng', 'mi quang'),
  ('banh mi thit', 'bánh mì thịt', 'banh mi thit'),
  ('banh xeo', 'bánh xèo', 'banh xeo'),
  ('com tam', 'cơm tấm', 'com tam'),
  ('lau bo', 'lẩu bò', 'lau bo'),
  ('ga nuong', 'gà nướng', 'ga nuong')
) AS v(normalized_name, alias, normalized_alias) ON cd.normalized_name = v.normalized_name
ON CONFLICT (normalized_alias) DO UPDATE SET
  canonical_dish_id = EXCLUDED.canonical_dish_id,
  alias = EXCLUDED.alias,
  source = EXCLUDED.source,
  confidence = EXCLUDED.confidence;
