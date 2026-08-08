# Food Discovery Platform - Technology Stack

## 1. Purpose

This document defines the proposed technology stack for the Food Discovery Platform. The stack is selected to support a modular, data-first architecture while remaining practical for local development, open-source deployment, and cost-conscious production use.

The technologies listed here are architectural decisions for the initial implementation. A replacement is allowed when it preserves the responsibilities, interfaces, and non-functional requirements described in the architecture documents.

---

## 2. Stack Summary

| Area             | Primary technology                        | Purpose                                                                        |
| ---------------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| Frontend         | React, TypeScript, Vite                   | Build the web application.                                                     |
| UI styling       | Tailwind CSS                              | Build consistent, responsive interfaces.                                       |
| Maps             | Leaflet                                   | Render maps and restaurant locations.                                          |
| Backend          | NestJS, TypeScript                        | Build modular REST APIs and background-service integrations.                   |
| Database         | PostgreSQL                                | Store canonical application and operational data.                              |
| Geospatial data  | PostGIS                                   | Support location, radius, and proximity queries.                               |
| Vector search    | pgvector                                  | Store embeddings and perform similarity search.                                |
| ORM              | Prisma                                    | Manage database schema and type-safe data access.                              |
| Cache and queue  | Redis                                     | Redis is available in Compose; BullMQ is not currently wired into the runtime. |
| Crawling         | TypeScript provider adapters + Playwright | Production collection uses the bounded Google Maps public result-page adapter. |
| AI generation    | Gemini Flash                              | Extract, enrich, classify, and explain data.                                   |
| AI embeddings    | Gemini Embedding                          | Generate semantic-search embeddings.                                           |
| Local deployment | Docker Compose                            | Run the development environment consistently.                                  |
| CI/CD            | GitHub Actions                            | Run automated checks and delivery workflows.                                   |

---

## 3. Frontend

### React

React is used for the web client because it supports component-based development, a large ecosystem, and a clear separation between presentation and backend business logic.

Frontend responsibilities include:

- Search and discovery user flows.
- Restaurant lists, detail pages, filters, and map views.
- API integration and client-side state management.
- Responsive and accessible user interface behavior.

The frontend must not contain crawler logic, data normalization, or duplicated ranking rules.

### TypeScript

TypeScript is used across frontend and backend services to improve refactoring safety, communicate data contracts, and reduce integration errors.

### Vite

Vite provides a fast local development server and optimized frontend builds with minimal configuration.

### Tailwind CSS

Tailwind CSS is used for responsive styling and a consistent design system. Reusable UI components should use shared design tokens rather than arbitrary repeated values.

### Leaflet

Leaflet is used to render interactive maps and markers. It keeps the frontend independent from a proprietary map SDK and can work with different tile providers.

---

## 4. Backend

### NestJS

NestJS is the primary backend framework. Its module, controller, service, and dependency-injection patterns fit the domain-oriented API structure defined in [01-system-architecture.md](01-system-architecture.md).

Backend responsibilities include:

- REST API routing, validation, and response shaping.
- Authentication and authorization when user and admin features are introduced.
- Search and recommendation orchestration.
- Access to PostgreSQL, Redis, and background-job services.
- Administrative APIs for data and crawler operations.

The backend must not run long crawler or embedding jobs inside an HTTP request.

### REST API

REST is the initial public interface because it is easy to consume from web, mobile, bots, and future third-party clients. APIs should be versioned, documented, validated, and kept backward-compatible where practical.

---

## 5. Data Storage

### PostgreSQL

PostgreSQL is the canonical database for restaurants, places, categories, dishes, reviews, source records, crawl runs, and user data. It is open source, reliable, and supports both relational queries and extensions needed by this project.

### PostGIS

PostGIS extends PostgreSQL with geographic types, spatial indexes, and functions. It supports nearby-place discovery, radius filters, distance calculations, and map-oriented data access.

### pgvector

pgvector stores embeddings alongside the rest of the domain data. This reduces operational complexity for the initial release and enables semantic search without introducing a separate vector database.

Vector storage is suitable for:

- Restaurant and dish descriptions.
- Reviews and curated food metadata.
- Natural-language semantic search.
- Recommendation candidate similarity.

### Prisma

Prisma manages the database schema, migrations, and type-safe database access for application services. Database-specific features such as PostGIS and pgvector may require carefully maintained raw SQL migrations or queries; those usages must remain documented and tested.

Detailed entity design belongs in [03-database-design.md](03-database-design.md).

---

## 6. Cache and Background Jobs

### Redis

Redis is used for short-lived cached data and as the backing store for asynchronous job queues. Initial caching targets may include frequently requested search metadata, categories, and rate-limited results.

Redis is not a source of truth. Canonical business data remains in PostgreSQL.

### BullMQ (planned)

The target architecture may use BullMQ with Redis for background work, including:

- Scheduled crawl tasks.
- Processing and normalization jobs.
- Deduplication and enrichment jobs.
- Embedding generation and refresh jobs.
- Retries for recoverable failures.

Workers must be idempotent and use bounded retry policies. Failed jobs must be observable and reviewable.

---

## 7. Crawler and Data Collection

### Browser automation

The current production crawler uses Playwright through an isolated Google Maps provider
adapter. It must comply with source terms, access controls, rate limits, and retention
rules. It does not use the Google Places API.

Crawler design is specified in [04-crawler-system.md](04-crawler-system.md).

---

## 8. AI and Semantic Search

### Gemini Flash

Gemini Flash is the initial model for latency- and cost-sensitive generative tasks, such as:

- Extracting structured attributes from unstructured text.
- Classifying food categories and restaurant characteristics.
- Producing concise recommendation explanations.
- Interpreting natural-language search intent ("Hỏi bếp").

The runtime intent interpreter (`backend/src/modules/ai/`, `AiIntentService`)
calls an OpenAI-compatible `/chat/completions` endpoint (`AI_BASE_URL`, default
Gemini's OpenAI-compatible endpoint, free tier OK). It converts the user's free
text into a bounded JSON intent, validates it against the real category
taxonomy, and feeds grounded SQL retrieval. When `AI_API_KEY` is empty or the
provider fails, requests fall back to deterministic rule-based
interpretation in `search.controller.ts`. Gemini Embedding is used for the
offline crawler Stage 7 embeddings.

### Gemini Embedding

Gemini Embedding is used to generate vector representations for search documents and suitable user queries. These vectors are stored in pgvector and used as one retrieval signal in hybrid search.

### AI Provider Abstraction

AI integrations must be implemented behind an internal provider interface. Domain services should request capabilities such as `generateEmbedding`, `extractMetadata`, or `generateExplanation` rather than calling a vendor SDK directly.

This allows the project to change models, introduce local models, or support multiple providers without changing business logic.

AI is an enhancement layer, not the canonical data store or the primary search engine. Candidate retrieval and ranking must remain deterministic and measurable.

---

## 9. Development and Deployment

### Docker and Docker Compose

Docker Compose is the standard local-development environment. It should define the backend, frontend, database, Redis, and worker services needed for a consistent setup.

Development configuration must use environment variables and example configuration files. Secrets must never be committed to the repository.

### Reverse Proxy and HTTPS

Production deployments should use a reverse proxy to terminate HTTPS, route traffic to the frontend and API, and provide a single public entry point. The specific proxy can be selected during deployment; Nginx, Caddy, and Traefik are compatible options.

### GitHub Actions

GitHub Actions is the initial CI/CD platform. Initial workflows should run linting, type checks, tests, and build verification for changed services. Deployment automation may be added after the application has a stable deployment target.

---

## 10. Technology Selection Rules

When adding or replacing a technology, evaluate it against these criteria:

- Compatibility with the modular architecture.
- Clear operational and maintenance cost.
- Open-source or low-cost deployment option when feasible.
- Active maintenance, security posture, and documentation quality.
- Ability to run locally for development and testing.
- A migration path that does not tightly couple domain logic to a vendor.

New infrastructure dependencies require documentation in this file and any affected architecture document before implementation.

---

## 11. Related Documents

- [00-project-overview.md](00-project-overview.md) — Project purpose, scope, and goals.
- [01-system-architecture.md](01-system-architecture.md) — System boundaries and component responsibilities.
- [03-database-design.md](03-database-design.md) — Database schema and indexing design.
- [04-crawler-system.md](04-crawler-system.md) — Crawler architecture and provider adapters.
- [05-data-pipeline.md](05-data-pipeline.md) — Processing and enrichment workflow.
- [06-backend-api-design.md](06-backend-api-design.md) — Backend modules and API contracts.
- [07-frontend-architecture.md](07-frontend-architecture.md) — Frontend structure and conventions.
- [08-ai-recommendation-system.md](08-ai-recommendation-system.md) — AI, retrieval, and ranking design.
