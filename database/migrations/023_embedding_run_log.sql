-- Embedding run observability (docs/05 Stage 7).
--
-- Stage 7 generates search-project vector embeddings from deterministic search
-- documents and stores them in `restaurant_embedding`. Each embedding run is
-- recorded in `enrichment_log` so cost, model, and coverage are observable.
-- `embeddings_applied` counts embeddings written during a run.

ALTER TABLE enrichment_log
  ADD COLUMN IF NOT EXISTS embeddings_applied integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN enrichment_log.embeddings_applied IS
  'Embeddings written during the run (Stage 7).';