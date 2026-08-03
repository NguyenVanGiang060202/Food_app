ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS password_reset_token_hash text,
  ADD COLUMN IF NOT EXISTS password_reset_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS app_user_password_reset_token_idx
  ON app_user (password_reset_token_hash)
  WHERE password_reset_token_hash IS NOT NULL;