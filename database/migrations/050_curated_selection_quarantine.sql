-- Keeps manually curated evidence removed from active recommendation truth.
-- The source image and raw OCR remain available for candidate discovery and
-- future operator review; only the exact-dish evidence row is quarantined.
BEGIN;

CREATE TABLE IF NOT EXISTS dish_evidence_quarantine (
  LIKE dish_evidence INCLUDING ALL
);

ALTER TABLE dish_evidence_quarantine
  ADD COLUMN IF NOT EXISTS quarantined_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE dish_evidence_quarantine
  ADD COLUMN IF NOT EXISTS quarantine_reason text NOT NULL DEFAULT 'removed from active recommendation evidence';

COMMENT ON TABLE dish_evidence_quarantine IS
  'Auditable dish evidence removed from active exact recommendation retrieval; source image/OCR remains intact.';

COMMIT;
