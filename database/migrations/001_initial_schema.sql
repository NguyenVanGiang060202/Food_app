-- Initial canonical catalog, source provenance, crawler operations and search schema.
-- Apply this file after the database extensions have been enabled.

CREATE TYPE restaurant_status AS ENUM ('active', 'temporarily_closed', 'permanently_closed', 'unknown');
CREATE TYPE restaurant_source_status AS ENUM ('active', 'missing', 'invalid', 'restricted');
CREATE TYPE crawl_run_status AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');
CREATE TYPE processing_stage AS ENUM ('validation', 'normalization', 'matching', 'enrichment', 'embedding');
CREATE TYPE processing_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'skipped');
CREATE TYPE dish_status AS ENUM ('available', 'unavailable', 'unknown');
CREATE TYPE image_status AS ENUM ('active', 'unavailable', 'restricted');

CREATE TABLE location (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  address_line text,
  ward text,
  district text,
  city text,
  country_code char(2),
  postal_code text,
  formatted_address text NOT NULL,
  coordinates geography(Point, 4326),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT location_country_code_chk CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$')
);

CREATE TABLE restaurant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalized_name text NOT NULL,
  description text,
  location_id uuid NOT NULL REFERENCES location(id) ON DELETE RESTRICT,
  phone text,
  website_url text,
  price_level smallint,
  rating numeric(2,1),
  review_count integer NOT NULL DEFAULT 0,
  status restaurant_status NOT NULL DEFAULT 'unknown',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_price_level_chk CHECK (price_level IS NULL OR price_level BETWEEN 1 AND 4),
  CONSTRAINT restaurant_rating_chk CHECK (rating IS NULL OR rating BETWEEN 0 AND 5),
  CONSTRAINT restaurant_review_count_chk CHECK (review_count >= 0)
);

CREATE TABLE category (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  parent_id uuid REFERENCES category(id) ON DELETE RESTRICT,
  description text,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE data_source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  base_url text,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE restaurant_source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE RESTRICT,
  data_source_id uuid NOT NULL REFERENCES data_source(id) ON DELETE RESTRICT,
  external_id text NOT NULL,
  source_url text,
  source_name text,
  source_rating numeric(2,1),
  source_review_count integer,
  raw_data jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  status restaurant_source_status NOT NULL DEFAULT 'active',
  UNIQUE (data_source_id, external_id),
  CONSTRAINT restaurant_source_rating_chk CHECK (source_rating IS NULL OR source_rating BETWEEN 0 AND 5),
  CONSTRAINT restaurant_source_review_count_chk CHECK (source_review_count IS NULL OR source_review_count >= 0)
);

CREATE TABLE restaurant_category (
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE RESTRICT,
  category_id uuid NOT NULL REFERENCES category(id) ON DELETE RESTRICT,
  source text,
  confidence numeric(4,3),
  PRIMARY KEY (restaurant_id, category_id),
  CONSTRAINT restaurant_category_confidence_chk CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1)
);

CREATE TABLE dish (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE RESTRICT,
  name text NOT NULL,
  normalized_name text NOT NULL,
  description text,
  price_amount numeric(12,2),
  currency_code char(3),
  is_popular boolean NOT NULL DEFAULT false,
  status dish_status NOT NULL DEFAULT 'unknown',
  CONSTRAINT dish_price_chk CHECK (price_amount IS NULL OR price_amount >= 0)
);

CREATE TABLE review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE RESTRICT,
  restaurant_source_id uuid NOT NULL REFERENCES restaurant_source(id) ON DELETE RESTRICT,
  external_review_id text,
  rating numeric(2,1),
  content text,
  reviewed_at timestamptz,
  language_code text,
  is_visible boolean NOT NULL DEFAULT true,
  CONSTRAINT review_rating_chk CHECK (rating IS NULL OR rating BETWEEN 0 AND 5),
  UNIQUE (restaurant_source_id, external_review_id)
);

CREATE TABLE restaurant_image (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE RESTRICT,
  restaurant_source_id uuid REFERENCES restaurant_source(id) ON DELETE RESTRICT,
  url text NOT NULL,
  alt_text text,
  sort_order integer NOT NULL DEFAULT 0,
  is_cover boolean NOT NULL DEFAULT false,
  status image_status NOT NULL DEFAULT 'active'
);

CREATE TABLE restaurant_hour (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE RESTRICT,
  day_of_week smallint NOT NULL,
  opens_at time,
  closes_at time,
  is_closed boolean NOT NULL DEFAULT false,
  spans_next_day boolean NOT NULL DEFAULT false,
  CONSTRAINT restaurant_hour_day_chk CHECK (day_of_week BETWEEN 1 AND 7),
  CONSTRAINT restaurant_hour_time_chk CHECK (is_closed OR (opens_at IS NOT NULL AND closes_at IS NOT NULL))
);

CREATE TABLE crawl_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_source_id uuid NOT NULL REFERENCES data_source(id) ON DELETE RESTRICT,
  job_type text NOT NULL,
  target jsonb NOT NULL DEFAULT '{}'::jsonb,
  status crawl_run_status NOT NULL DEFAULT 'queued',
  started_at timestamptz,
  finished_at timestamptz,
  records_found integer NOT NULL DEFAULT 0,
  records_processed integer NOT NULL DEFAULT 0,
  error_message text,
  CONSTRAINT crawl_run_counters_chk CHECK (records_found >= 0 AND records_processed >= 0)
);

CREATE TABLE processing_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crawl_run_id uuid NOT NULL REFERENCES crawl_run(id) ON DELETE RESTRICT,
  restaurant_source_id uuid REFERENCES restaurant_source(id) ON DELETE RESTRICT,
  external_id text,
  stage processing_stage NOT NULL,
  status processing_status NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  error_details jsonb,
  processed_at timestamptz,
  CONSTRAINT processing_attempt_chk CHECK (attempt_count >= 0)
);

CREATE TABLE restaurant_embedding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE RESTRICT,
  embedding vector,
  model text NOT NULL,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, model, content_hash)
);

CREATE INDEX location_coordinates_gist_idx ON location USING gist (coordinates);
CREATE INDEX restaurant_status_idx ON restaurant (status);
CREATE INDEX restaurant_name_trgm_idx ON restaurant USING gin (name gin_trgm_ops);
CREATE INDEX restaurant_normalized_name_trgm_idx ON restaurant USING gin (normalized_name gin_trgm_ops);
CREATE INDEX restaurant_source_restaurant_idx ON restaurant_source (restaurant_id);
CREATE INDEX restaurant_category_category_idx ON restaurant_category (category_id);
CREATE INDEX dish_normalized_name_trgm_idx ON dish USING gin (normalized_name gin_trgm_ops);
CREATE INDEX review_restaurant_reviewed_idx ON review (restaurant_id, reviewed_at DESC);
CREATE INDEX crawl_run_operations_idx ON crawl_run (data_source_id, status, started_at DESC);
CREATE INDEX processing_record_retry_idx ON processing_record (status, attempt_count, processed_at);

COMMENT ON COLUMN restaurant_embedding.embedding IS 'Dimension is enforced by the embedding model contract until a production model is selected.';-- Keep updated_at consistent for canonical records.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER location_set_updated_at BEFORE UPDATE ON location
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER restaurant_set_updated_at BEFORE UPDATE ON restaurant
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX restaurant_rating_idx ON restaurant (rating DESC NULLS LAST, review_count DESC);
CREATE INDEX restaurant_price_level_idx ON restaurant (price_level);
CREATE INDEX location_city_district_idx ON location (city, district);
CREATE INDEX restaurant_hour_lookup_idx ON restaurant_hour (restaurant_id, day_of_week);
CREATE INDEX restaurant_image_lookup_idx ON restaurant_image (restaurant_id, is_cover, status, sort_order);
CREATE INDEX dish_restaurant_status_idx ON dish (restaurant_id, status, is_popular DESC);
CREATE INDEX category_active_slug_idx ON category (is_active, slug);

-- Natural keys keep repeated crawler runs and seed imports idempotent.
CREATE UNIQUE INDEX dish_restaurant_normalized_name_uidx
  ON dish (restaurant_id, normalized_name);
CREATE UNIQUE INDEX restaurant_image_source_url_uidx
  ON restaurant_image (
    restaurant_id,
    COALESCE(restaurant_source_id, '00000000-0000-0000-0000-000000000000'::uuid),
    url
  );

-- A source record has one processing state per crawl run and pipeline stage.
-- This keeps retries/audits idempotent instead of appending duplicate rows.
CREATE UNIQUE INDEX processing_record_run_external_stage_uidx
  ON processing_record (
    crawl_run_id,
    COALESCE(restaurant_source_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(external_id, ''),
    stage
  );
