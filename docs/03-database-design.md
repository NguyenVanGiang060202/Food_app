# Food Discovery Platform - Database Design

## 1. Purpose

This document defines the logical database design for the Food Discovery Platform. PostgreSQL is the canonical source of truth for normalized restaurant data, source provenance, crawler operations, and user-owned data.

The schema must support multi-source ingestion, data quality controls, geographic discovery, hybrid search, and future personalization without allowing provider-specific data structures to leak into the core model.

---

## 2. Database Principles

- Use normalized canonical entities for business data.
- Preserve source provenance for every externally collected record.
- Treat external identifiers as provider-scoped, not globally unique.
- Store geographic coordinates using PostGIS geography types.
- Store vector embeddings using pgvector alongside searchable domain content.
- Prefer soft lifecycle states over destructive deletion for imported data.
- Enforce data integrity with constraints, foreign keys, and database indexes.
- Keep raw or source-specific payloads outside the canonical entity fields.

---

## 3. PostgreSQL Extensions

The initial database requires the following extensions:

| Extension | Purpose |
| --- | --- |
| `postgis` | Geographic points, distance calculations, and spatial indexes. |
| `vector` | Vector embedding storage and similarity search. |
| `pg_trgm` | Fuzzy text matching for search and deduplication. |
| `uuid-ossp` or `pgcrypto` | UUID generation, depending on migration conventions. |

All extensions must be enabled by explicit database migrations.

---

## 4. Entity Overview

```text
Restaurant ──< RestaurantSource >── DataSource
    │  │
    │  ├──< RestaurantCategory >── Category
    │  ├──< RestaurantImage
    │  ├──< RestaurantHour
    │  ├──< Review
    │  ├──< Dish
    │  ├──< RestaurantEmbedding
    │  └──< CrawlRecord / ProcessingRecord
    │
    └── Location

User ──< UserPreference
User ──< UserInteraction >── Restaurant
```

`Restaurant` represents the canonical place. `RestaurantSource` connects that place to one or more external providers and preserves provenance. A restaurant should never be duplicated solely because it appears on multiple sources.

---

## 5. Core Entities

### 5.1 Restaurant

The canonical representation of a restaurant, cafe, food stall, bar, or other food venue.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key. |
| `name` | text | Canonical display name. |
| `normalized_name` | text | Normalized value for matching and deduplication. |
| `description` | text, nullable | Curated or generated description. |
| `location_id` | UUID | Required foreign key to `location`. |
| `phone` | text, nullable | Normalized phone number when available. |
| `website_url` | text, nullable | Canonical website URL when available. |
| `price_level` | smallint, nullable | Controlled range, initially 1–4. |
| `rating` | numeric(2,1), nullable | Aggregated rating; range 0–5. |
| `review_count` | integer | Aggregated review count; default 0. |
| `status` | enum | `active`, `temporarily_closed`, `permanently_closed`, `unknown`. |
| `created_at` | timestamptz | Creation timestamp. |
| `updated_at` | timestamptz | Last canonical update. |

The canonical rating and review count are derived values. Their calculation strategy must be explicit in the data pipeline and must not overwrite source-level facts.

### 5.2 Location

Stores a normalized address and spatial position. Keeping location separate enables future support for branches, place changes, and non-restaurant location types.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key. |
| `address_line` | text, nullable | Primary street address. |
| `ward` | text, nullable | Administrative sub-area. |
| `district` | text, nullable | District or equivalent area. |
| `city` | text, nullable | City. |
| `country_code` | char(2), nullable | ISO 3166-1 alpha-2 code. |
| `postal_code` | text, nullable | Postal code, if available. |
| `formatted_address` | text | Human-readable normalized address. |
| `coordinates` | geography(Point, 4326) | Latitude and longitude. |
| `created_at` | timestamptz | Creation timestamp. |
| `updated_at` | timestamptz | Update timestamp. |

Coordinates may initially be nullable for incomplete source records, but nearby search must only use records with valid coordinates.

### 5.3 Category

Represents controlled food and venue classifications, such as `Vietnamese`, `Coffee Shop`, `Italian`, or `Vegetarian`.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key. |
| `name` | text | Display name. |
| `slug` | text | Unique stable identifier. |
| `parent_id` | UUID, nullable | Self-reference for category hierarchy. |
| `description` | text, nullable | Optional explanation. |
| `is_active` | boolean | Controls availability for discovery. |

`restaurant_category` is a many-to-many join table with `restaurant_id`, `category_id`, `source`, and optional confidence metadata.

### 5.4 Dish

Represents a dish associated with a restaurant. It supports dish-level discovery and future menu features without requiring a full menu-management system.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key. |
| `restaurant_id` | UUID | Required foreign key to `restaurant`. |
| `name` | text | Dish name. |
| `normalized_name` | text | Matching value. |
| `description` | text, nullable | Description when available. |
| `price_amount` | numeric(12,2), nullable | Price when known. |
| `currency_code` | char(3), nullable | ISO 4217 code. |
| `is_popular` | boolean | Source-derived or curated flag. |
| `status` | enum | `available`, `unavailable`, `unknown`. |

### 5.5 Review

Stores a review associated with a restaurant and its source. Review text may be unavailable or restricted by a provider; the system must retain only data that collection and retention policies allow.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key. |
| `restaurant_id` | UUID | Required foreign key to `restaurant`. |
| `restaurant_source_id` | UUID | Source provenance. |
| `external_review_id` | text, nullable | Provider review identifier. |
| `rating` | numeric(2,1), nullable | Range 0–5 when available. |
| `content` | text, nullable | Retained review content, if permitted. |
| `reviewed_at` | timestamptz, nullable | Original review time. |
| `language_code` | text, nullable | BCP 47 or project convention. |
| `is_visible` | boolean | Content availability control. |

### 5.6 RestaurantImage

Stores image references and metadata, not necessarily image binaries.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key. |
| `restaurant_id` | UUID | Required foreign key. |
| `restaurant_source_id` | UUID, nullable | Source provenance. |
| `url` | text | Original or managed image URL. |
| `alt_text` | text, nullable | Accessible description. |
| `sort_order` | integer | Display order. |
| `is_cover` | boolean | Cover-image indicator. |
| `status` | enum | `active`, `unavailable`, `restricted`. |

### 5.7 RestaurantHour

Stores regular opening hours in local venue time.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key. |
| `restaurant_id` | UUID | Required foreign key. |
| `day_of_week` | smallint | ISO day number, 1–7. |
| `opens_at` | time, nullable | Opening time. |
| `closes_at` | time, nullable | Closing time. |
| `is_closed` | boolean | Closed for the entire day. |
| `spans_next_day` | boolean | Supports late-night venues. |

Multiple rows per day are allowed to support split service hours.

---

## 6. Source Provenance and Operations

### 6.1 DataSource

Defines a supported external provider.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key. |
| `code` | text | Unique internal provider code. |
| `name` | text | Display name. |
| `base_url` | text, nullable | Provider base URL. |
| `is_active` | boolean | Enables or disables new collection. |

### 6.2 RestaurantSource

Maps a canonical restaurant to a record from one provider.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key. |
| `restaurant_id` | UUID | Required canonical restaurant reference. |
| `data_source_id` | UUID | Required provider reference. |
| `external_id` | text | Provider-scoped identifier. |
| `source_url` | text, nullable | Original record URL. |
| `source_name` | text, nullable | Name observed from the provider. |
| `source_rating` | numeric(2,1), nullable | Rating observed from the provider. |
| `source_review_count` | integer, nullable | Review count observed from the provider. |
| `raw_data` | jsonb, nullable | Allowed raw payload or normalized source snapshot. |
| `first_seen_at` | timestamptz | First collection time. |
| `last_seen_at` | timestamptz | Most recent successful collection time. |
| `status` | enum | `active`, `missing`, `invalid`, `restricted`. |

The pair `(data_source_id, external_id)` must be unique.

### 6.3 CrawlRun

Records the operational result of a scheduled or manually triggered crawl.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key. |
| `data_source_id` | UUID | Crawled provider. |
| `job_type` | text | Discovery, detail refresh, review refresh, and so on. |
| `target` | jsonb | Query, area, or target parameters. |
| `status` | enum | `queued`, `running`, `completed`, `failed`, `cancelled`. |
| `started_at` | timestamptz, nullable | Start time. |
| `finished_at` | timestamptz, nullable | End time. |
| `records_found` | integer | Number of source records found. |
| `records_processed` | integer | Number processed successfully. |
| `error_message` | text, nullable | Safe operational error summary. |

### 6.4 ProcessingRecord

Tracks a raw or source record through the normalization pipeline.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key. |
| `crawl_run_id` | UUID | Originating crawl run. |
| `restaurant_source_id` | UUID, nullable | Resolved source link. |
| `external_id` | text, nullable | ID before source resolution. |
| `stage` | enum | `validation`, `normalization`, `matching`, `enrichment`, `embedding`. |
| `status` | enum | `pending`, `processing`, `completed`, `failed`, `skipped`. |
| `attempt_count` | integer | Processing attempts. |
| `error_details` | jsonb, nullable | Structured failure data. |
| `processed_at` | timestamptz, nullable | Completion time. |

---

## 7. Search and AI Entities

### 7.1 RestaurantEmbedding

Stores embeddings for a canonical restaurant. Embeddings may be generated from a combination of name, categories, description, dishes, and selected review summaries.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key. |
| `restaurant_id` | UUID | Required foreign key. |
| `embedding` | vector | Dimension must match the selected embedding model. |
| `model` | text | Model identifier. |
| `content_hash` | text | Detects stale embeddings. |
| `created_at` | timestamptz | Generation time. |

There should be at most one active embedding per restaurant and model version. Old embeddings may be retained only when required for migration or evaluation.

### 7.2 SearchDocument

An optional denormalized search projection may be introduced when measured performance requires it. It may contain prepared full-text search vectors, a normalized display payload, and refresh timestamps.

It is a derived read model and must always be rebuildable from canonical tables.

---

## 8. User and Personalization Entities

User data is introduced only when authentication and personalization features are implemented.

| Entity | Purpose |
| --- | --- |
| `user` | User identity and account lifecycle. |
| `user_preference` | Dietary preferences, cuisines, price range, and location preferences. |
| `user_interaction` | Saved places, clicks, views, dismissals, and explicit feedback. |
| `user_saved_restaurant` | Explicitly saved or bookmarked restaurants. |

Personal data must be minimized, access controlled, and separated from imported provider data. Analytics events should not be required for the core restaurant catalog to function.

---

## 9. Key Relationships and Constraints

- One `restaurant` has one primary `location` in the initial model.
- One `restaurant` has zero or more source records, categories, dishes, reviews, images, hours, and embeddings.
- One `data_source` has zero or more `restaurant_source` and `crawl_run` records.
- One source record maps to exactly one canonical restaurant after matching, unless it remains unresolved for review.
- A provider external identifier is unique only within its `data_source`.
- Ratings must be between 0 and 5 when present.
- `price_level` must be within the project-defined range when present.
- Review counts and operational counters must be non-negative.
- Timestamps use `timestamptz`; local opening times use `time` with the restaurant's geographic context.

Foreign keys should use restrictive deletion behavior for canonical data. Import records should normally be marked inactive rather than removed when a source no longer exposes them.

---

## 10. Indexing Strategy

Indexes must be added based on primary read and write paths. The initial design requires:

| Table / data | Index | Reason |
| --- | --- | --- |
| `restaurant` | B-tree on `status` | Filter active records. |
| `restaurant` | Trigram GIN on `name` and `normalized_name` | Fuzzy name search and matching. |
| `location` | GiST on `coordinates` | Nearby and distance queries. |
| `restaurant_source` | Unique B-tree on `(data_source_id, external_id)` | Provider identity integrity. |
| `restaurant_source` | B-tree on `restaurant_id` | Source provenance lookups. |
| `restaurant_category` | Composite indexes on both foreign-key paths | Category filtering. |
| `dish` | Trigram GIN on normalized name | Dish search and matching. |
| `review` | B-tree on `restaurant_id, reviewed_at` | Restaurant detail queries. |
| `crawl_run` | B-tree on `data_source_id, status, started_at` | Operational monitoring. |
| `restaurant_embedding` | pgvector ANN index appropriate to the distance metric | Semantic candidate retrieval. |

Full-text indexes and vector ANN index settings must be chosen after defining actual search documents, embedding dimensions, record counts, and recall/latency targets.

---

## 11. Deduplication Strategy

Deduplication is performed by the data pipeline, not by a single database unique constraint. It should evaluate several signals:

1. Exact match of provider external identifier within the same source.
2. Normalized phone number or website URL match.
3. Similar normalized name combined with close geographic distance.
4. Address similarity and category consistency.
5. Human review or conservative unresolved state for ambiguous matches.

The matching decision must be auditable. The system should retain source records even if they are later linked to the same canonical restaurant.

---

## 12. Data Lifecycle and Retention

- Canonical restaurant records remain active until they are verified as unavailable, closed, or invalid.
- Source records track `last_seen_at` and may be marked missing when not found in later collection runs.
- Raw payload retention must follow provider terms, privacy rules, and project policy.
- Derived records such as embeddings and search documents can be regenerated and may be safely replaced.
- Database backups, migration history, and restoration procedures are mandatory before production use.

---

## 13. Migration and Naming Rules

- Use `snake_case` for tables, columns, indexes, and database enums.
- Use singular names for entity tables: `restaurant`, `review`, `category`.
- Use explicit join-table names such as `restaurant_category`.
- Every schema change must be represented by a version-controlled migration.
- Avoid editing applied production migrations; create a new migration instead.
- Add indexes deliberately and document unusual database-specific queries.

---

## 14. Related Documents

- [00-project-overview.md](00-project-overview.md) — Project scope and goals.
- [01-system-architecture.md](01-system-architecture.md) — System components and data flow.
- [02-tech-stack.md](02-tech-stack.md) — PostgreSQL, PostGIS, pgvector, and Prisma choices.
- [04-crawler-system.md](04-crawler-system.md) — Source collection and crawl records.
- [05-data-pipeline.md](05-data-pipeline.md) — Validation, normalization, and matching flow.
- [06-backend-api-design.md](06-backend-api-design.md) — Database-facing backend services.
- [08-ai-recommendation-system.md](08-ai-recommendation-system.md) — Embeddings, hybrid search, and ranking.
