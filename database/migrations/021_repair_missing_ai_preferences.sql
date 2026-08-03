-- Repair installations where migration 011 was recorded as applied before
-- the AI preferences column was present in the database.
ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS ai_preferences jsonb NOT NULL DEFAULT '{}'::jsonb;
