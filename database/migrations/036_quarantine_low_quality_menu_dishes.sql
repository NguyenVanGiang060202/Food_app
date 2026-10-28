-- OCR may return confident-looking gibberish for blurred Google Maps photos.
-- Keep the rows for audit, but prevent them from becoming recommendation truth.
UPDATE dish d
SET status = 'unavailable'
WHERE d.status = 'available'
  AND d.source = 'menu_image:vision:v1'
  AND NOT (
    d.normalized_name ~ '(bun|pho|com|mi|banh|canh|chao|chay|che|cafe|ca phe|bo|ga|heo|thit|suon|cua|tom|muc|ca|oc|lau|nuong|xao|chien|hap|luoc|kho|sot|pizza|sushi|vit|goi|nem|chao|hu tieu|mi quang|trung)'
  );

COMMENT ON TABLE dish IS
  'Dish facts require auditable evidence; low-quality OCR rows may be retained as unavailable for reprocessing.';
