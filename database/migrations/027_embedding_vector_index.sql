-- pgvector ANN index for restaurant_embedding (docs/05 Stage 7, P0.0).
--
-- The runtime semantic_score lookup in RestaurantsRepository.list computes a
-- per-row cosine similarity (1 - embedding <=> vector). HNSW with
-- vector_cosine_ops turns that linear scan into an approximate-nearest-neighbor
-- lookup, which matters once the table grows past a few thousand rows.
--
-- An HNSW index requires a FIXED vector dimension, but migration 001 stored
-- `embedding vector` without a dimension. This migration locks the column to
-- the dimension actually present in the data, so it works regardless of the
-- embedding model chosen (OpenAI, Gemini, Ollama/bge-m3, ...).
--
-- This file is idempotent and is re-applied on every `npm run db:migrate`
-- (like the reference-data seed). With no vectors it reports and does nothing;
-- after `npm run embed:once --workspace crawler` has written vectors, the next
-- migrate locks the dimension and builds the index automatically.

DO $$
DECLARE
  dim integer;
BEGIN
  SELECT COALESCE(MAX(vector_dims(embedding)), 0) INTO dim FROM restaurant_embedding;
  IF dim = 0 THEN
    RAISE NOTICE 'restaurant_embedding has no vectors yet; run npm run embed:once then re-run migrations to build the HNSW index.';
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'restaurant_embedding'::regclass
      AND attname = 'embedding'
      AND atttypmod > 0
  ) THEN
    EXECUTE format('ALTER TABLE restaurant_embedding ALTER COLUMN embedding TYPE vector(%s)', dim);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'restaurant_embedding_embedding_hnsw_idx'
  ) THEN
    EXECUTE 'CREATE INDEX restaurant_embedding_embedding_hnsw_idx
             ON restaurant_embedding USING hnsw (embedding vector_cosine_ops)';
    EXECUTE 'COMMENT ON INDEX restaurant_embedding_embedding_hnsw_idx IS
             ''Approximate nearest-neighbor index for cosine similarity used by the runtime semantic search path.''';
  END IF;
END $$;
