-- Broad dish names must not imply a cooking method.
-- Earlier enrichment mapped `com tam` and `com suon` to `grilled`, which made
-- generic OCR/template rows appear as verified grilled-menu matches. Keep the
-- dish facts and other attributes, but remove only the unsafe method links.
BEGIN;

DELETE FROM dish_attribute da
USING dish d, food_attribute fa
WHERE da.dish_id = d.id
  AND da.attribute_id = fa.id
  AND d.normalized_name IN ('com tam', 'com suon')
  AND fa.normalized = 'nuong';

COMMIT;
