# Food Discovery Platform - System Architecture

## 1. Purpose

This document defines the high-level architecture of the Food Discovery Platform. Its purpose is to establish clear boundaries between data collection, data processing, storage, backend services, and client applications.

The system is designed to be data-first, modular, scalable, and cost-conscious. Each component must be independently deployable or replaceable without requiring a redesign of the entire platform.

---

## 2. Architectural Principles

- **Separation of concerns:** Crawling, processing, storage, API delivery, and user interfaces have separate responsibilities.
- **Database as the source of truth:** Client applications and recommendation services consume normalized internal data, not raw external-source responses.
- **Asynchronous ingestion:** Crawling and data-processing workloads run outside the synchronous API request path.
- **Provider isolation:** Source-specific logic stays inside the crawler layer and never leaks into core domain or recommendation logic.
- **API-first delivery:** All client applications use versioned backend APIs.
- **Replaceable infrastructure:** AI providers, crawlers, queues, and client applications can be changed with limited impact on other layers.
- **Observability by design:** Background jobs, crawler runs, failures, and data quality must be traceable.

---

## 3. High-Level Architecture

```text
┌───────────────────────────────────────────────────────────────────┐
│                        External Data Sources                        │
│ Google Maps │ Food websites │ Review platforms │ Future providers   │
└──────────────────────────────┬────────────────────────────────────┘
                               │
                               ▼
┌───────────────────────────────────────────────────────────────────┐
│                           Crawler Layer                             │
│ Provider adapters │ Scheduling │ Rate limiting │ Raw-data capture   │
└──────────────────────────────┬────────────────────────────────────┘
                               │
                               ▼
┌───────────────────────────────────────────────────────────────────┐
│                         Data Pipeline Layer                         │
│ Validation │ Normalization │ Deduplication │ Enrichment │ Retry     │
└──────────────────────────────┬────────────────────────────────────┘
                               │
                               ▼
┌───────────────────────────────────────────────────────────────────┐
│                            Data Layer                               │
│ PostgreSQL │ Geospatial indexes │ Search indexes │ Vector embeddings │
└───────────────┬──────────────────────────────┬────────────────────┘
                │                              │
                ▼                              ▼
┌──────────────────────────┐      ┌─────────────────────────────────┐
│  Backend API Layer       │      │ Recommendation & AI Layer       │
│ Auth │ Search │ Places   │◀────▶│ Retrieval │ Ranking │ Explanation │
└──────────────┬───────────┘      └─────────────────────────────────┘
               │
               ▼
┌───────────────────────────────────────────────────────────────────┐
│                            Client Layer                             │
│ Web application │ Admin dashboard │ Mobile │ Bots │ Public clients  │
└───────────────────────────────────────────────────────────────────┘
```

---

## 4. Component Responsibilities

| Layer | Main responsibilities | Must not be responsible for |
| --- | --- | --- |
| Crawler | Retrieve source data, respect rate limits, preserve source metadata, emit crawl jobs/results. | Search ranking, frontend behavior, direct client responses. |
| Data pipeline | Validate, normalize, deduplicate, enrich, and persist data. | Rendering UI or source-specific user flows. |
| Data layer | Store canonical records, raw references, job state, and search/vector data. | Business decisions embedded in database triggers. |
| Backend API | Authorize requests, expose domain APIs, orchestrate search and detail reads. | Long-running crawl or enrichment work during a request. |
| Recommendation system | Retrieve candidates, calculate ranking signals, generate optional explanations. | Owning canonical restaurant data. |
| Frontend | Present data, collect user input, and call APIs. | Crawling, data normalization, or business-rule duplication. |

---

## 5. Crawler Architecture

Each external provider must be implemented as an adapter behind a common interface. The interface enables the scheduler and pipeline to treat sources consistently while allowing provider-specific parsing and authentication inside the adapter.

```text
Crawl scheduler
      │
      ▼
Provider adapter interface
      ├── Google Maps adapter
      ├── Food website adapter
      ├── Review-platform adapter
      └── Future provider adapters
      │
      ▼
Raw crawl result + source metadata
      │
      ▼
Processing queue
```

Every crawl run should record the provider, execution time, query or target area, status, record count, and error details. Raw source payloads or auditable normalized snapshots should be retained according to the data-retention policy defined later.

---

## 6. Data Processing Architecture

The pipeline converts inconsistent provider data into canonical domain records.

```text
Raw crawl result
      ↓
Schema validation
      ↓
Field normalization
      ↓
Entity matching and deduplication
      ↓
Data enrichment
      ↓
Canonical database records
      ↓
Search and embedding updates
```

Processing steps must be idempotent. Reprocessing the same source record must update or safely skip its canonical record instead of creating duplicates.

Long-running work is executed through background jobs. Failed jobs use retry policies and eventually enter a reviewable failed state rather than failing silently.

---

## 7. Data Storage Architecture

PostgreSQL is the canonical transactional database. It stores restaurants, locations, categories, dishes, reviews, source references, crawl executions, and processing status.

The data layer will support the following access patterns:

- Exact and filtered restaurant lookup.
- Geospatial queries, such as nearby restaurants within a radius.
- Keyword search over restaurant and food attributes.
- Similarity search over vector embeddings.
- Auditing from a canonical record back to its source data.

Detailed schemas and indexes are defined in [03-database-design.md](03-database-design.md).

---

## 8. Search and Recommendation Architecture

Search and recommendation are separate concerns, but work together in one request flow.

```text
User query and context
      ↓
Query parsing and filter extraction
      ↓
Candidate retrieval
  ├── keyword search
  ├── category and attribute filters
  ├── geospatial search
  └── semantic/vector search
      ↓
Ranking
  ├── relevance and semantic similarity
  ├── distance
  ├── rating and review quality
  ├── category and availability match
  └── user preferences, when available
      ↓
Optional AI explanation
      ↓
API response
```

Large language models are not the primary search engine. They may interpret ambiguous language, enrich data, or explain ranked results after retrieval has narrowed the candidate set.

---

## 9. Backend API Architecture

The backend API is the only public entry point for applications. It is responsible for request validation, authentication and authorization when applicable, response shaping, and access to domain services.

The API should be organized by business domain rather than by database table. Initial domains include:

- Restaurants and restaurant details.
- Search and discovery.
- Categories and food metadata.
- Recommendations.
- Users and preferences.
- Administrative data and crawler operations.

The API must not access provider websites directly during normal user requests. It reads data produced by the ingestion pipeline.

---

## 10. Client Architecture

The web application is the first client. It consumes the backend API and provides:

- Restaurant discovery and search.
- Filters and map-based exploration.
- Restaurant-detail pages.
- Recommendation results and explanations.
- User preference controls when personalization is introduced.

Future clients, including mobile applications, Telegram or Discord bots, and public API consumers, must use the same backend API. Client-specific logic must not change canonical data or duplicate core business rules.

---

## 11. Cross-Cutting Concerns

### Security

- Store provider credentials and API secrets outside source control.
- Validate and sanitize all API input.
- Apply authorization to administrative operations.
- Limit exposure of raw provider data and personally identifiable information.

### Reliability

- Use queues for crawl, processing, enrichment, and embedding work.
- Apply timeouts, retry policies, and rate limits to external requests.
- Design background jobs to be idempotent.
- Preserve enough job and source metadata for troubleshooting.

### Observability

- Log API errors, crawler outcomes, job failures, and processing metrics.
- Track crawl freshness, successful records, duplicate rates, and failed jobs.
- Monitor API latency and search/recommendation quality signals.

### Scalability

- Scale crawler workers independently from the API service.
- Scale read-heavy API workloads independently from background workers.
- Add database indexes and caching based on measured query patterns.
- Keep provider adapters stateless wherever possible.

---

## 12. Deployment Topology

The local development environment should run the required services with Docker Compose. A production deployment can run the same logical services in containers behind a reverse proxy with HTTPS.

```text
Internet
   ↓
Reverse proxy / HTTPS
   ↓
Frontend + Backend API
   ├── PostgreSQL
   ├── Cache / job queue
   ├── Crawler workers
   └── Processing and AI workers
```

The architecture must avoid mandatory cloud-vendor dependencies. Individual services may be hosted, self-managed, or replaced as operational needs change.

---

## 13. Related Documents

- [00-project-overview.md](00-project-overview.md) — Project purpose and scope.
- [02-tech-stack.md](02-tech-stack.md) — Selected technologies and rationale.
- [03-database-design.md](03-database-design.md) — Data model and persistence design.
- [04-crawler-system.md](04-crawler-system.md) — Crawler contracts and operation.
- [05-data-pipeline.md](05-data-pipeline.md) — Processing rules and workflows.
- [06-backend-api-design.md](06-backend-api-design.md) — API contracts and backend modules.
- [08-ai-recommendation-system.md](08-ai-recommendation-system.md) — Recommendation and AI design.
