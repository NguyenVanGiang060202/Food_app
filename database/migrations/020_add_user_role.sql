ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';

ALTER TABLE app_user
  DROP CONSTRAINT IF EXISTS app_user_role_check;

ALTER TABLE app_user
  ADD CONSTRAINT app_user_role_check CHECK (role IN ('user', 'admin'));

CREATE INDEX IF NOT EXISTS app_user_role_idx ON app_user (role);