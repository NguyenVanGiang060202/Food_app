ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_verification_token_hash text,
  ADD COLUMN IF NOT EXISTS email_verification_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS auth_provider text NOT NULL DEFAULT 'password',
  ADD COLUMN IF NOT EXISTS provider_subject text;

-- Users created before email verification existed are already trusted by the app.
-- New registrations keep email_verified_at NULL until their verification link is used.
UPDATE app_user
SET email_verified_at = COALESCE(created_at, now())
WHERE email_verified_at IS NULL
  AND email_verification_token_hash IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS app_user_provider_subject_unique
  ON app_user (auth_provider, provider_subject)
  WHERE provider_subject IS NOT NULL;