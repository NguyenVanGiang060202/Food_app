DROP INDEX IF EXISTS restaurant_image_cached_hash_uidx;
CREATE INDEX IF NOT EXISTS restaurant_image_cached_hash_idx
  ON restaurant_image (cached_content_hash)
  WHERE cached_content_hash IS NOT NULL;
