# Food Discovery Platform - Data Pipeline

## 1. Purpose

This document defines how externally collected restaurant data becomes trusted, searchable, canonical data. The pipeline receives provider-neutral source records from the crawler system, validates and transforms them, resolves duplicates, enriches usable records, and updates search projections.

The pipeline is asynchronous, idempotent, observable, and designed to preserve source attribution at every stage.

---

## 2. Pipeline Principles

- **Canonical data over raw data:** User-facing services use normalized canonical records, not unprocessed provider payloads.
- **Source provenance is preserved:** Every imported fact remains traceable to a provider record and crawl run.
- **Idempotency:** Processing the same source record multiple times must not create duplicate canonical records.
- **Progressive enrichment:** A valid partial record may be stored and enriched later rather than discarded unnecessarily.
- **Deterministic core:** Validation, normalization, and matching must be explainable and measurable; AI may enrich but must not silently override trusted facts.
- **Recoverability:** Each stage records its state and failures so work can be retried safely.
- **Policy-aware retention:** Raw data and generated data follow provider, privacy, and project retention requirements.

---

## 3. High-Level Flow

```text
SourceRestaurantRecord
        ↓
1. validateSourceRecord
        ↓
2. normalizeSourceRecord
        ↓
3. CanonicalUpsertPipeline.process
        ├─ source identity upsert
        ├─ name/coordinate or address matching
        ├─ restaurant/location upsert
        ├─ categories, images, dishes, hours
        └─ processing_record(normalization=completed)
        ↓
Canonical restaurant record
```

The validation, normalization, and persistence steps currently run as one bounded
unit inside the one-shot crawler worker. The schema supports more processing stages,
but separate enrichment, embedding, and processing queues are not implemented yet.
`processing_record` currently records the successful normalization/persistence step
and is also exposed for operational retry/review.

---

## 4. Input Contract

The pipeline consumes `SourceRestaurantRecord` objects emitted by a provider adapter. The minimum required fields are:

| Field            | Requirement                                                  |
| ---------------- | ------------------------------------------------------------ |
| `providerCode`   | Must identify an active configured data source.              |
| `externalId`     | Must be stable and unique within the provider.               |
| `collectedAt`    | Must indicate when the source data was retrieved.            |
| `name`           | Required unless the provider record is rejected as unusable. |
| `sourceUrl`      | Required when the source exposes a stable record URL.        |
| `sourceMetadata` | Must include data required to audit the collection result.   |

Other fields, including address, coordinates, ratings, categories, reviews, and images, are optional. Missing optional fields reduce completeness but do not automatically make a record invalid.

---

## 5. Stage 1: Intake and Schema Validation

Intake validates the source-record shape before any canonical data is changed.

Validation includes:

- Active provider code and valid provider configuration.
- Non-empty source external ID and restaurant name.
- Valid timestamps, numeric values, URLs, and coordinate ranges.
- Allowed field sizes and data types.
- Required provenance metadata.
- Removal of duplicate records in a single crawl result by provider external ID.

Invalid data is not sent to canonical persistence. The current executor logs a
structured record-level failure and continues processing unrelated records from the
crawl run. Persisted `processing_record` failure classification is a future hardening
step; successful persistence currently records the `normalization=completed` stage.

---

## 6. Stage 2: Field Normalization

Normalization converts provider formats into consistent internal values without losing the original source reference.

| Data type     | Normalization rules                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| Names         | Trim whitespace, normalize Unicode, remove repeated spacing, and create a comparison form in `normalized_name`. |
| Addresses     | Standardize spacing, components, country code, and formatted address conventions.                               |
| Phone numbers | Parse to a consistent international representation when country context is known.                               |
| URLs          | Validate scheme, normalize host and redundant tracking parameters where safe.                                   |
| Coordinates   | Convert to WGS 84 latitude/longitude and validate ranges before creating a PostGIS point.                       |
| Ratings       | Convert provider scale only when its scale is known; otherwise preserve as source metadata.                     |
| Price levels  | Map provider values to the project-controlled price-level scale with a documented mapping.                      |
| Hours         | Convert to day/time intervals and retain source text if parsing is incomplete.                                  |
| Categories    | Map source labels to controlled category candidates; preserve unknown labels for review.                        |
| Text          | Sanitize encoding, remove unsafe markup, and enforce length limits.                                             |

Normalization must be deterministic. Any provider-specific assumptions or mappings must be versioned in code and test fixtures.

---

## 7. Stage 3: Source Upsert and Freshness Update

The pipeline upserts the provider-specific identity before cross-source matching:

1. Resolve `data_source` from `providerCode`.
2. Find or create `restaurant_source` using `(data_source_id, external_id)`.
3. Update source-facing fields, `source_url`, `last_seen_at`, and permitted raw/source metadata.
4. Link the source record to the current `crawl_run` and `processing_record`.

This is the primary idempotency key. Reprocessing a source record from the same provider must update the same `restaurant_source` rather than create another one.

---

## 8. Stage 4: Entity Matching and Deduplication

The current pipeline implements a bounded subset of the design:

- An existing `(data_source, external_id)` source identity is reused first.
- Otherwise, a non-permanently-closed restaurant with the same normalized name and
  coordinates within 150 metres is reused.
- Without coordinates, normalized name plus optional formatted address/city checks
  are used.
- If no candidate matches, a new location and restaurant are created.

Phone, website, trigram, category confidence, and unresolved-match workflows are
not part of the current `CanonicalUpsertPipeline` matching query.

Entity matching determines whether a source record belongs to an existing canonical restaurant or requires a new one.

### Matching order

1. Existing `restaurant_id` on the same `restaurant_source`.
2. Exact normalized phone number or canonical website URL match.
3. High-confidence name and geographic proximity match.
4. Address similarity combined with name and category signals.
5. Create an unresolved record or send for review when confidence is insufficient.

### Match signals

| Signal               | Example use                                               |
| -------------------- | --------------------------------------------------------- |
| Provider identity    | Exact same provider and external ID.                      |
| Name similarity      | Normalized exact, token, or trigram similarity.           |
| Geographic distance  | Candidate must be within a defined distance threshold.    |
| Address similarity   | Street, district, city, and formatted-address comparison. |
| Phone or website     | Strong identity signal when valid.                        |
| Category consistency | Supporting signal, never the sole identity signal.        |

The matching result stores its decision, confidence, algorithm version, and relevant evidence. Automated matching should favor precision over recall; uncertain records must not merge unrelated venues.

---

## 9. Stage 5: Canonical Record Upsert

Once a source record is matched or approved as new, the pipeline creates or updates canonical entities:

- `restaurant` and `location`.
- `restaurant_category` mappings.
- Dishes, opening hours, images, and reviews where collection and retention are permitted.
- Aggregated rating, review count, status, and completeness fields.

Canonical updates follow explicit merge rules:

- Higher-confidence and fresher facts take precedence.
- Source-specific values remain in `restaurant_source`; canonical fields are derived from source facts.
- Missing values from a new source must not erase established canonical values.
- Conflicting high-confidence values are flagged for review or resolved by documented source-priority rules.
- Updates must record `updated_at` and preserve the source that supported the change.

---

## 10. Stage 6: Enrichment

This stage is **partially implemented** as a one-shot offline CLI in the crawler
workspace (`crawler/src/enrichment/`, run with
`npm run enrich:once --workspace crawler`). It is deterministic and only fills
gaps: it never overrides crawler/fixture-observed facts.

- Category classification (`category-classifier.ts`): keyword rules over the
  accent-free restaurant name, precision-first. Writes `restaurant_category`
  with `source = 'enrichment:category:rules:v1'` and a confidence, only for
  restaurants that have no category mapping yet.
- Dish detection (`dish-extractor.ts`): a curated Vietnamese dish lexicon
  matched against the restaurant name and visible review text. Writes `dish`
  rows (price remains NULL — no price is inferred) with
  `source = 'enrichment:dish:lexicon:v1'` and confidence, only for restaurants
  that have no dishes yet.
- Each run is recorded in `enrichment_log` (run type, model, params, status,
  counts, failure message); `--dry-run` computes counts without writing.
- Embedding generation (Stage 7) is not part of this implementation yet.

Enrichment improves discovery quality after canonical storage. It is optional and must never prevent a valid restaurant from becoming available unless the enrichment is required by a data-quality rule.

Possible enrichment tasks include:

- Category mapping and food ontology tagging.
- Extraction of restaurant attributes from permitted descriptions or reviews.
- Location and address component completion.
- Popular-dish identification.
- Detection of dietary, ambiance, service, or accessibility attributes.
- Generation of concise searchable descriptions.
- Quality and completeness scoring.

AI-generated values must be marked with their generation source, model/version, confidence, and update time. They must be replaceable and distinguishable from provider-supplied or manually curated facts.

---

## 11. Stage 7: Search Projection and Embedding Updates

This stage is **partially implemented** as a one-shot offline CLI in the crawler
workspace (`crawler/src/embedding/`, run with `npm run embed:once --workspace
crawler`, requires migration `023`). It generates vector embeddings from
deterministic search documents and stores them in `restaurant_embedding`; it
never mutates canonical data.

- `search-document.ts` builds a versioned, deterministic embedding input
  (name, normalized name, categories, dish names, district/city, price level)
  and a SHA-256 `content_hash`. The embedding `model` in
  `restaurant_embedding` records both the provider model and the template
  version (`<provider>@doc:v1`), so model, dimension, and template are versioned
  together (docs/08 section 7).
- `embedding-provider.ts` is an internal provider interface implemented by an
  OpenAI-compatible client (`/embeddings`). Configure via `EMBEDDING_BASE_URL`,
  `EMBEDDING_API_KEY`, `EMBEDDING_MODEL`, and optional `EMBEDDING_DIMENSIONS`
  (dimension mismatch is rejected before writing).
- `embedding-loader.ts` backfills only restaurants with no vector for the active
  model (an idempotent default). `--refresh` also re-embeds restaurants whose
  content changed. Old vectors for the same `(restaurant, model)` are replaced,
  so at most one active embedding exists per restaurant and model version.
  Every run is recorded in `enrichment_log` with `run_type = 'embedding'`;
  `--dry-run` computes counts without calling any provider.
- Keyword/full-text projection and the pgvector ANN index are not implemented
  yet (index dimensions must be chosen once the embedding model, document
  template, and scale are fixed). The fallback similarity flow in
  `backend/restaurants.repository.ts` remains the only item near search today.

Search documents and vector embeddings are derived data. They are generated only after a canonical restaurant record is valid enough to search.

```text
Canonical restaurant update
        ↓
Build deterministic search document
        ↓
Update keyword/full-text projection
        ↓
Calculate content hash
        ↓
Generate embedding only when content changed
        ↓
Upsert restaurant embedding
        ↓
Mark search state ready
```

The content hash prevents unnecessary embedding costs. Search or embedding failures must not corrupt canonical data; they leave the restaurant in a retryable derived-data state.

---

## 12. Data Quality and Completeness

Each canonical restaurant should have a derived quality state based on measurable fields.

| Level      | Example criteria                                               | Search behavior                                   |
| ---------- | -------------------------------------------------------------- | ------------------------------------------------- |
| Complete   | Name, valid location, category, and sufficient source support. | Fully searchable and eligible for recommendation. |
| Partial    | Name plus at least one stable identity or location field.      | Searchable with limited ranking confidence.       |
| Unresolved | Identity or matching ambiguity remains.                        | Not publicly searchable until resolved.           |
| Invalid    | Fails validation or violates policy.                           | Excluded from canonical discovery.                |
| Inactive   | Closed, restricted, or no longer available.                    | Excluded or clearly labeled by product rules.     |

Quality thresholds must be implemented as documented rules, not hidden assumptions in client code.

---

## 13. Failure Handling and Recovery

| Failure type                        | Pipeline response                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| Invalid source field                | Mark the source record failed or skipped with validation details.                   |
| Temporary database or queue failure | Retry the stage with bounded exponential backoff.                                   |
| Ambiguous duplicate match           | Keep the source record unresolved and send it to review or later matching.          |
| Enrichment or embedding failure     | Retain canonical data; retry only the derived-data task.                            |
| Unsupported provider data           | Preserve allowed source attribution and mark unsupported fields for adapter review. |

In the current implementation, invalid records are logged and do not block unrelated
records. A transaction failure in `CanonicalUpsertPipeline.process` is rolled back
for that record. A provider or executor failure marks the whole `crawl_run` failed.
The backend retry endpoint resets eligible `processing_record` rows with fewer than
five attempts; a worker-side stage retry queue is future work.

---

## 14. Reprocessing and Backfills

The system must support reprocessing without uncontrolled duplication. Reprocessing is needed when:

- Normalization rules change.
- Category mappings or ontology rules improve.
- A matching algorithm is updated.
- An embedding model changes.
- A provider parser is fixed.
- Missing fields become available from a later crawl.

Reprocessing jobs must be bounded by provider, date range, geography, record IDs, or pipeline version. They should record the requested reason and preserve a clear audit trail.

---

## 15. Operational Metrics

The pipeline should measure:

- Input records per provider and crawl run.
- Validation failure rate and causes.
- New, updated, matched, unresolved, and inactive restaurants.
- Duplicate-match confidence distribution.
- Stage duration, queue delay, retry count, and final failure rate.
- Data freshness and completeness distribution.
- Search-document and embedding generation latency and cost.

Metrics are used to improve data quality, control costs, and detect provider changes early.

---

## 16. Related Documents

- [01-system-architecture.md](01-system-architecture.md) — Overall data flow and component boundaries.
- [03-database-design.md](03-database-design.md) — Canonical entities, source provenance, and indexes.
- [04-crawler-system.md](04-crawler-system.md) — Provider adapters and source-record output.
- [06-backend-api-design.md](06-backend-api-design.md) — APIs that consume canonical records and expose administration.
- [08-ai-recommendation-system.md](08-ai-recommendation-system.md) — Search documents, embeddings, and ranking.
- [09-development-rules.md](09-development-rules.md) — Engineering and documentation standards.
