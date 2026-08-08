-- Enrichment provenance and an observable enrichment log.
--
-- The enrichment stage (docs/05 Stage 6) derives category and dish facts from
-- restaurant names and review text. Derived values must be distinguishable from
-- provider/crawler-observed facts (README Data Quality Policy), so category and
-- dish rows carry a `source` + `confidence`, and every run is recorded in
-- `enrichment_log`.
--
-- `source` on dish is NULL for crawler/fixture-observed facts; enrichment rows
-- use 'enrichment:<model>'. `restaurant_category.source` already exists and is
-- filled by the crawler with the provider code.

ALTER TABLE restaurant_category
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

ALTER TABLE dish
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS confidence numeric;

CREATE INDEX IF NOT EXISTS idx_dish_source ON dish (source) WHERE source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_restaurant_category_source
  ON restaurant_category (source) WHERE source IS NOT NULL;

CREATE TABLE IF NOT EXISTS enrichment_log (
  id bigserial PRIMARY KEY,
  run_type text NOT NULL,
  model text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  restaurants_scanned integer NOT NULL DEFAULT 0,
  categories_applied integer NOT NULL DEFAULT 0,
  dishes_applied integer NOT NULL DEFAULT 0,
  failure_message text
);
