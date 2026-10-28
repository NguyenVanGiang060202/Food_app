CREATE TABLE IF NOT EXISTS recommendation_interaction (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE CASCADE,
  interaction_type text NOT NULL,
  query_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recommendation_interaction_type_check CHECK (interaction_type IN ('open', 'save', 'dismiss'))
);

CREATE INDEX IF NOT EXISTS recommendation_interaction_restaurant_idx
  ON recommendation_interaction (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recommendation_interaction_user_created_idx
  ON recommendation_interaction (user_id, created_at DESC);
