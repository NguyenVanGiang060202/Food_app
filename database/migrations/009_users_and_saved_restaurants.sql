CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text,
  role text NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_user_role_check CHECK (role IN ('user', 'admin'))
);

CREATE TABLE IF NOT EXISTS saved_restaurant (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, restaurant_id)
);

CREATE INDEX IF NOT EXISTS saved_restaurant_user_created_idx ON saved_restaurant (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS app_user_role_idx ON app_user (role);
DROP TRIGGER IF EXISTS app_user_set_updated_at ON app_user;
CREATE TRIGGER app_user_set_updated_at BEFORE UPDATE ON app_user
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
