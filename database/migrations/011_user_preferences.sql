ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS favorite_category_slugs text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS dietary_preferences text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS preferred_price_levels integer[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE app_user
  DROP CONSTRAINT IF EXISTS app_user_preferred_price_levels_check;

ALTER TABLE app_user
  ADD CONSTRAINT app_user_preferred_price_levels_check
  CHECK (preferred_price_levels <@ ARRAY[1, 2, 3, 4]::integer[]);