-- Phase 2 review intelligence: idempotent opinion extraction persistence.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS review_opinion_extraction_dedupe_idx
  ON review_opinion(review_id, dish_id, aspect, sentiment, mention);

COMMENT ON COLUMN review_opinion.extraction_method IS 'Deterministic or model-backed extraction strategy/version identifier.';
COMMENT ON COLUMN review_opinion.model_version IS 'Extraction rules/model version; nullable for manually sourced opinions.';

COMMIT;
