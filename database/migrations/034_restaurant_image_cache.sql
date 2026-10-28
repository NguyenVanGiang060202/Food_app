ALTER TABLE restaurant_image
  ADD COLUMN IF NOT EXISTS cached_object_key text,
  ADD COLUMN IF NOT EXISTS cached_content_hash text,
  ADD COLUMN IF NOT EXISTS cached_content_type text,
  ADD COLUMN IF NOT EXISTS cached_file_size bigint,
  ADD COLUMN IF NOT EXISTS cached_at timestamptz,
  ADD COLUMN IF NOT EXISTS cache_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS cache_error text;

ALTER TABLE restaurant_image
  DROP CONSTRAINT IF EXISTS restaurant_image_cache_status_chk;
ALTER TABLE restaurant_image
  ADD CONSTRAINT restaurant_image_cache_status_chk
  CHECK (cache_status IN ('pending', 'cached', 'failed', 'skipped'));

CREATE INDEX IF NOT EXISTS restaurant_image_cache_queue_idx
  ON restaurant_image (cache_status, is_cover, sort_order, id);
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_image_cached_hash_uidx
  ON restaurant_image (cached_content_hash)
  WHERE cached_content_hash IS NOT NULL;
