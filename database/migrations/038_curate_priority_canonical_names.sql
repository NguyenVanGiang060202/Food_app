-- Canonical display names are curated independently from noisy restaurant OCR
-- spelling. This affects presentation and intent canonicalization only; it
-- does not broaden dish identity beyond exact normalized names/aliases.
UPDATE canonical_dish SET canonical_name = v.canonical_name, updated_at = now()
FROM (VALUES
  ('bun bo hue', 'Bún bò Huế'),
  ('pho bo', 'Phở bò'),
  ('pho ga', 'Phở gà'),
  ('bun rieu', 'Bún riêu'),
  ('bun thit nuong', 'Bún thịt nướng'),
  ('bun dau mam tom', 'Bún đậu mắm tôm'),
  ('hu tieu nam vang', 'Hủ tiếu Nam Vang'),
  ('mi quang', 'Mì Quảng'),
  ('banh mi thit', 'Bánh mì thịt'),
  ('banh xeo', 'Bánh xèo'),
  ('com tam', 'Cơm tấm'),
  ('lau bo', 'Lẩu bò'),
  ('ga nuong', 'Gà nướng')
) AS v(normalized_name, canonical_name)
WHERE canonical_dish.normalized_name = v.normalized_name;
