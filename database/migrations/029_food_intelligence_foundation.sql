-- Evidence-first Food Intelligence foundation.
BEGIN;

CREATE TABLE IF NOT EXISTS canonical_dish (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL,
  normalized_name text NOT NULL UNIQUE,
  cuisine text,
  category text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS canonical_dish_alias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_dish_id uuid NOT NULL REFERENCES canonical_dish(id) ON DELETE CASCADE,
  alias text NOT NULL,
  normalized_alias text NOT NULL UNIQUE,
  source text NOT NULL DEFAULT 'normalization',
  confidence numeric(4,3),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1)
);

ALTER TABLE dish ADD COLUMN IF NOT EXISTS canonical_dish_id uuid
  REFERENCES canonical_dish(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS dish_canonical_dish_idx ON dish(canonical_dish_id);

CREATE OR REPLACE FUNCTION normalize_food_name(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(regexp_replace(
    lower(unaccent(COALESCE(p_name, ''))),
    '[^a-z0-9]+', ' ', 'g'
  ));
$$;

CREATE OR REPLACE FUNCTION sync_canonical_dish_for_row()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_normalized text;
  v_canonical_id uuid;
BEGIN
  v_normalized := normalize_food_name(NEW.name);
  IF v_normalized = '' THEN
    NEW.canonical_dish_id := NULL;
    RETURN NEW;
  END IF;

  INSERT INTO canonical_dish (canonical_name, normalized_name)
  VALUES (trim(NEW.name), v_normalized)
  ON CONFLICT (normalized_name) DO NOTHING;

  SELECT id INTO v_canonical_id
  FROM canonical_dish
  WHERE normalized_name = v_normalized;

  NEW.canonical_dish_id := v_canonical_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dish_canonical_dish_sync ON dish;
CREATE TRIGGER dish_canonical_dish_sync
BEFORE INSERT OR UPDATE OF name, normalized_name ON dish
FOR EACH ROW EXECUTE FUNCTION sync_canonical_dish_for_row();

-- Backfill existing dishes after the trigger is installed. Exact normalized
-- identity is intentionally conservative: semantic/fuzzy matching remains a
-- ranking concern and must not silently merge distinct dishes.
INSERT INTO canonical_dish (canonical_name, normalized_name)
SELECT min(name), normalize_food_name(name)
FROM dish
WHERE normalize_food_name(name) <> ''
GROUP BY normalize_food_name(name)
ON CONFLICT (normalized_name) DO NOTHING;

UPDATE dish d
SET canonical_dish_id = cd.id
FROM canonical_dish cd
WHERE cd.normalized_name = normalize_food_name(d.name)
  AND d.canonical_dish_id IS DISTINCT FROM cd.id;

CREATE TABLE IF NOT EXISTS review_opinion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES review(id) ON DELETE CASCADE,
  dish_id uuid REFERENCES dish(id) ON DELETE SET NULL,
  canonical_dish_id uuid REFERENCES canonical_dish(id) ON DELETE SET NULL,
  aspect text NOT NULL,
  sentiment smallint NOT NULL CHECK (sentiment BETWEEN -1 AND 1),
  mention text,
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  extraction_method text NOT NULL,
  model_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_opinion_review_idx ON review_opinion(review_id);
CREATE INDEX IF NOT EXISTS review_opinion_dish_idx ON review_opinion(dish_id, canonical_dish_id);

CREATE INDEX IF NOT EXISTS review_opinion_restaurant_aspect_idx
  ON review_opinion(review_id, aspect, sentiment);

CREATE TABLE IF NOT EXISTS restaurant_food_profile (
  restaurant_id uuid PRIMARY KEY REFERENCES restaurant(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'stale' CHECK (status IN ('stale', 'building', 'ready', 'failed')),
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_coverage numeric(4,3) NOT NULL DEFAULT 0 CHECK (evidence_coverage BETWEEN 0 AND 1),
  built_at timestamptz,
  invalidated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS restaurant_food_profile_status_idx ON restaurant_food_profile(status, invalidated_at);

CREATE OR REPLACE FUNCTION mark_food_profile_stale_from_dish()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM mark_food_profile_stale(OLD.restaurant_id);
    RETURN OLD;
  END IF;
  PERFORM mark_food_profile_stale(NEW.restaurant_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION mark_food_profile_stale_from_review()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM mark_food_profile_stale(OLD.restaurant_id);
    RETURN OLD;
  END IF;
  PERFORM mark_food_profile_stale(NEW.restaurant_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION mark_food_profile_stale_from_opinion()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_restaurant_id uuid;
BEGIN
  SELECT restaurant_id INTO v_restaurant_id
  FROM review
  WHERE id = COALESCE(NEW.review_id, OLD.review_id);
  IF v_restaurant_id IS NOT NULL THEN
    PERFORM mark_food_profile_stale(v_restaurant_id);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION mark_food_profile_stale(p_restaurant_id uuid)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO restaurant_food_profile (restaurant_id, status, invalidated_at)
  VALUES (p_restaurant_id, 'stale', now())
  ON CONFLICT (restaurant_id) DO UPDATE
    SET status = 'stale', invalidated_at = now(), updated_at = now();
$$;

DROP TRIGGER IF EXISTS dish_food_profile_invalidation ON dish;
CREATE TRIGGER dish_food_profile_invalidation
AFTER INSERT OR UPDATE OR DELETE ON dish
FOR EACH ROW EXECUTE FUNCTION mark_food_profile_stale_from_dish();

DROP TRIGGER IF EXISTS review_food_profile_invalidation ON review;
CREATE TRIGGER review_food_profile_invalidation
AFTER INSERT OR UPDATE OR DELETE ON review
FOR EACH ROW EXECUTE FUNCTION mark_food_profile_stale_from_review();

DROP TRIGGER IF EXISTS review_opinion_food_profile_invalidation ON review_opinion;
CREATE TRIGGER review_opinion_food_profile_invalidation
AFTER INSERT OR UPDATE OR DELETE ON review_opinion
FOR EACH ROW EXECUTE FUNCTION mark_food_profile_stale_from_opinion();

COMMENT ON TABLE canonical_dish IS 'Canonical dish identity independent of restaurant-specific menu rows.';
COMMENT ON TABLE review_opinion IS 'Subjective review-derived opinions; intentionally separate from menu facts.';
COMMENT ON TABLE restaurant_food_profile IS 'Versioned deterministic profile derived from persisted evidence.';

COMMIT;
